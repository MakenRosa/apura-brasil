import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,unlink,stat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {assertPhotoUrl,photoUpstream} from './photo-identity.mjs';
import {buildUrl} from './service.mjs';
import {normalizeResult} from './normalize.mjs';
import {contentTag} from './http-cache.mjs';

const jpeg=body=>body?.length>=4&&body[0]===255&&body[1]===216&&body[2]===255&&body[body.length-2]===255&&body[body.length-1]===217;
const hash=url=>createHash('sha256').update(url).digest('hex');
export class PhotoClient {
 constructor(tse,{dataDir=null,ttl=86400000,timeout=6000,maxBytes=2*1024*1024,maxEntries=500,maxDiskBytes=50*1024*1024,maxMemoryEntries=100,maxMemoryBytes=16*1024*1024,minInterval=1100,maxQueued=32,now=Date.now}={}) {
  Object.assign(this,{tse,dataDir,ttl,timeout,maxBytes,maxEntries,maxDiskBytes,maxMemoryEntries,maxMemoryBytes,minInterval,maxQueued,now});this.entries=new Map();this.bodies=new Map();this.bodyInflight=new Map();this.bodyTags=new WeakMap();this.memoryBytes=0;this.stats={hits:0,diskReads:0,coalescedReads:0,revalidations:0};this.inflight=new Map();this.queue=[];this.active=false;this.lastStart=-Infinity;this.photoPauseUntil=0;this.missingStreak=0;this.persistChain=Promise.resolve();this.ready=this.restore();
 }
 file(url){const root=resolve(this.dataDir),file=join(root,hash(url)+'.jpeg');if(dirname(file)!==root)throw new Error('Caminho de foto inválido.');return file;}
 async restore(){
  if(!this.dataDir)return;
  try{const file=join(this.dataDir,'photo-cache.json');if((await stat(file)).size>2*1024*1024)return;const manifest=JSON.parse(await readFile(file,'utf8'));
   if(manifest.version!==1)return;this.photoPauseUntil=Number(manifest.photoPauseUntil)||0;
   for(const [url,entry] of (manifest.entries||[]).slice(-this.maxEntries)){try{assertPhotoUrl(url);if(entry&&Number(entry.bytes||0)<=this.maxBytes)this.entries.set(url,entry);}catch{}}
  }catch{}
 }
 async body(url,entry){
  if(this.bodies.has(url)){const body=this.bodies.get(url);this.bodies.delete(url);this.bodies.set(url,body);return body;}if(!entry?.bytes||!this.dataDir)return null;
  const key=url+':'+(entry.contentTag||entry.fetchedAt||'')+':'+entry.bytes;
  if(this.bodyInflight.has(key)){this.stats.coalescedReads++;return this.bodyInflight.get(key);}
  const promise=(async()=>{try{const path=this.file(url);if((await stat(path)).size>this.maxBytes)return null;this.stats.diskReads++;const body=await readFile(path);if(!jpeg(body)||body.length!==entry.bytes||entry.contentTag&&contentTag(body)!==entry.contentTag)return null;this.remember(url,body);return body;}catch{return null;}})().finally(()=>this.bodyInflight.delete(key));
  this.bodyInflight.set(key,promise);return promise;
 }
 forgetBody(url){const body=this.bodies.get(url);if(body)this.memoryBytes-=body.length;this.bodies.delete(url);}
 remember(url,body){this.forgetBody(url);this.bodies.set(url,body);this.memoryBytes+=body.length;while(this.bodies.size>this.maxMemoryEntries||this.memoryBytes>this.maxMemoryBytes)this.forgetBody(this.bodies.keys().next().value);}
 bodyTag(body){if(!body)return undefined;let tag=this.bodyTags.get(body);if(!tag){tag=contentTag(body);this.bodyTags.set(body,tag);}return tag;}
 trim(){const removed=[];let size=[...this.entries.values()].reduce((n,e)=>n+(e.bytes||0),0);while(this.entries.size>this.maxEntries||size>this.maxDiskBytes){const url=[...this.entries.keys()].find(url=>!this.inflight.has(url));if(!url)break;const old=this.entries.get(url);this.entries.delete(url);this.forgetBody(url);size-=old.bytes||0;removed.push(url);}return removed;}
 async persist(){
  if(!this.dataDir){this.trim();return;}
  this.persistChain=this.persistChain.catch(()=>{}).then(async()=>{
   await mkdir(this.dataDir,{recursive:true});for(const url of this.trim())try{await unlink(this.file(url));}catch{}
   const file=join(this.dataDir,'photo-cache.json');await writeFile(file+'.tmp',JSON.stringify({version:1,photoPauseUntil:this.photoPauseUntil,entries:[...this.entries]}));await rename(file+'.tmp',file);
  }).catch(()=>{});return this.persistChain;
 }
 async flush(){await this.persistChain;}
 metrics(){return {...this.stats,entries:this.entries.size,memoryEntries:this.bodies.size,memoryBytes:this.memoryBytes,inFlight:this.inflight.size,diskReadInFlight:this.bodyInflight.size,queued:this.queue.length};}
 view(url,entry,body,state,message){return {body,state,url,mime:'image/jpeg',fetchedAt:entry?.fetchedAt?new Date(entry.fetchedAt).toISOString():null,httpStatus:entry?.httpStatus,nextRetryAt:Math.max(entry?.retryAt||0,this.tse.cooldownUntil,this.photoPauseUntil)>this.now()?new Date(Math.max(entry?.retryAt||0,this.tse.cooldownUntil,this.photoPauseUntil)).toISOString():null,...(message?{message}:{}),etag:this.bodyTag(body)};}
 async get(url){
  assertPhotoUrl(url);await Promise.all([this.ready,this.tse.ready]);if(this.inflight.has(url))return this.inflight.get(url);
  const entry=this.entries.get(url);if(entry){this.entries.delete(url);this.entries.set(url,entry);}const body=await this.body(url,entry);
  if(this.inflight.has(url))return this.inflight.get(url);
  if(Math.max(entry?.retryAt||0,this.tse.cooldownUntil,this.photoPauseUntil)>this.now())return this.view(url,entry,body,body?'stale':'unavailable',entry?.error||'Pausa de acesso ao TSE.');
  const validatedAt=entry?.validatedAt??(entry?.error?entry?.fetchedAt:entry?.checkedAt);
  if(body&&Number.isFinite(validatedAt)&&this.now()-validatedAt<this.ttl){this.stats.hits++;return this.view(url,entry,body,'cached');}
  if(this.queue.length>=this.maxQueued)return this.view(url,entry,body,body?'stale':'unavailable','Fila local de fotos cheia; solicite novamente mais tarde.');
  // The own queue permits one photo at a time. Shared TSE queue gives data requests priority.
  const promise=new Promise((resolve,reject)=>{this.queue.push({url,resolve,reject});this.pump();}).finally(()=>this.inflight.delete(url));this.inflight.set(url,promise);return promise;
 }
 pump(){
  if(this.active||!this.queue.length)return;const delay=this.minInterval-(this.now()-this.lastStart);
  if(delay>0){if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.pump();},delay);return;}
  this.active=true;this.lastStart=this.now();const task=this.queue.shift();
  this.tse.enqueue(()=>this.request(task.url),{priority:'photo'}).then(task.resolve,task.reject).finally(()=>{this.active=false;this.pump();});
 }
 async request(url){
  const old=this.entries.get(url)||{},body=await this.body(url,old);
  if(Math.max(this.tse.cooldownUntil,this.photoPauseUntil)>this.now())return this.view(url,old,body,body?'stale':'unavailable','Pausa de acesso ao TSE.');
  let response;
  try {
   const headers={Accept:'image/jpeg'};if(body&&old.etag)headers['If-None-Match']=old.etag;if(body&&old.lastModified)headers['If-Modified-Since']=old.lastModified;
   this.stats.revalidations++;this.tse.requests++;response=await this.tse.fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(this.timeout)});
   if(response.status===304&&body){const entry={...old,checkedAt:this.now(),validatedAt:this.now(),httpStatus:304,retryAt:0,failures:0,error:null};this.entries.set(url,entry);await this.persist();return this.view(url,entry,body,'cached');}
   if(!response.ok)throw Object.assign(new Error(response.status===404?'Foto oficial ainda não disponível.':`TSE respondeu HTTP ${response.status} para a foto.`),{status:response.status});
   if(response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='image/jpeg')throw new Error('Resposta TSE não é uma fotografia JPEG.');
   if(Number(response.headers.get('content-length'))>this.maxBytes)throw new Error('Fotografia excede limite de tamanho.');
   let photo;
   if(response.body?.getReader){const reader=response.body.getReader(),parts=[];let bytes=0;while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>this.maxBytes){await reader.cancel();throw new Error('Fotografia excede limite de tamanho.');}parts.push(Buffer.from(value));}photo=Buffer.concat(parts);}
   else{photo=Buffer.from(await response.arrayBuffer());if(photo.length>this.maxBytes)throw new Error('Fotografia excede limite de tamanho.');}
   if(!jpeg(photo))throw new Error('Assinatura JPEG inválida.');
   const entry={bytes:photo.length,contentTag:this.bodyTag(photo),fetchedAt:this.now(),checkedAt:this.now(),validatedAt:this.now(),httpStatus:response.status,retryAt:0,failures:0,etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')};
   this.entries.delete(url);this.entries.set(url,entry);this.remember(url,photo);this.missingStreak=0;
   if(this.dataDir)try{await mkdir(this.dataDir,{recursive:true});const file=this.file(url);await writeFile(file+'.tmp',photo);await rename(file+'.tmp',file);}catch{}
   await this.persist();return this.view(url,entry,photo,'live');
  }catch(error){
   const status=error.status||response?.status,failures=(old.failures||0)+1;
   if([403,429].includes(status)){this.tse.cooldownUntil=this.now()+600000;this.tse.lastError=error.message;await this.tse.persist();}
   if(status===404&&++this.missingStreak>=3)this.photoPauseUntil=this.now()+600000;
   const wait=status===404?Math.min(1800000,60000*2**Math.min(failures-1,5)):[403,429].includes(status)?600000:300000;
   const entry={...old,validatedAt:old.validatedAt??(old.error?old.fetchedAt:old.checkedAt)??null,checkedAt:this.now(),httpStatus:status,retryAt:this.now()+wait,failures,error:error.name==='TimeoutError'?'Tempo limite ao consultar a foto oficial.':error.message};if(!body){delete entry.etag;delete entry.lastModified;}this.entries.set(url,entry);await this.persist();return this.view(url,entry,body,body?'stale':'unavailable',entry.error);
  }
 }
}
export class CandidatePhotoService {
 constructor(elections,photos){this.elections=elections;this.photos=photos;}
 async get(query,sequence){
  if(!/^\d{1,20}$/.test(sequence))throw Object.assign(new Error('Sequencial de candidatura inválido.'),{status:400});
  const resolved=await this.elections.resolve(query),resultUrl=buildUrl('u',resolved.query,resolved.election,resolved.config.raw);
  // Only an EA20 already collected by results authorizes a photograph. Image requests never
  // trigger a sweep, a result download for each candidate, or a search by name.
  await this.elections.client.ready;const raw=this.elections.client.cache.get(resultUrl)?.raw;
  if(!raw)throw Object.assign(new Error('Consulte os resultados oficiais antes de solicitar esta foto.'),{status:503});
  const data=this.elections.normalizedResult?this.elections.normalizedResult(raw,resolved.query,resolved.election):normalizeResult(raw,resolved.query,resolved.election);
  if(raw.f!=='o'||!data.candidates.some(candidate=>candidate.sequence===sequence))throw Object.assign(new Error('Candidatura não consta neste resultado oficial.'),{status:404});
  return this.photos.get(photoUpstream(resolved.query,sequence,resolved.config.raw));
 }
}
