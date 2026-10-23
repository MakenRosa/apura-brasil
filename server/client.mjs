import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import {createHash} from 'node:crypto';
import { join } from 'node:path';
import { BASE } from './constants.mjs';
import { generatedAt, phase, str } from './normalize.mjs';
import {historyCandidates,regionalHistoryKey,regionalHistoryPoint,olderRegionalPoint} from './history.mjs';

export function assertOfficialUrl(url) {
 const parsed=new URL(url);
 if(parsed.origin!==BASE||parsed.username||parsed.password||parsed.search||parsed.hash||!/^\/oficial\/(?:[a-z0-9-]+\/)+[a-z0-9-]+\.json$/.test(parsed.pathname))throw new Error('URL fora dos arquivos oficiais permitidos.');
 return parsed.href;
}
const iso = value => new Date(value).toISOString();
export class TseClient {
 constructor({fetchImpl=globalThis.fetch,now=Date.now,dataDir=null,minInterval=350,timeout=12000,maxEntries=64,maxCacheBytes=64*1024*1024,maxHistoryBytes=16*1024*1024,historyLimit=120,historyCandidates=50}={}) {
  this.fetchImpl=fetchImpl;this.now=now;this.dataDir=dataDir;this.minInterval=Math.max(0,minInterval);this.timeout=timeout;this.maxEntries=maxEntries;this.historyLimit=historyLimit;this.historyCandidates=historyCandidates;
  this.cache=new Map();this.regionalHistories=new Map();this.inflight=new Map();this.queue=[];this.active=0;this.lastStart=-Infinity;this.cooldownUntil=0;this.requests=0;this.lastError=null;this.persistChain=Promise.resolve();this.started=this.now();
  this.ready=this.restore();
  this.maxCacheBytes=maxCacheBytes;this.maxHistoryBytes=maxHistoryBytes;this.retainedEntries=new Map();this.regionalVectors=new Map();this.rawSizes=new WeakMap();this.historySizes=new WeakMap();this.rawDigests=new WeakMap();this.validated=new WeakMap();this.metrics={cacheHits:0,validationHits:0,persistenceWrites:0,persistenceSkipped:0};this.persistRevision=0;this.lastPersisted=null;
 }
 async restore() {
  if(!this.dataDir)return;
  try {
   const file=join(this.dataDir,'tse-cache.json');if((await stat(file)).size>this.maxCacheBytes+this.maxHistoryBytes+4*1024*1024)throw new Error('Cache excede limite local.');
   const saved=JSON.parse(await readFile(file,'utf8'));
   if(saved.version!==1)return;
   this.cooldownUntil=Number(saved.cooldownUntil)||0;
   for(const [url,entry] of (saved.entries||[]).slice(-this.maxEntries)) {
    try{assertOfficialUrl(url);if(entry&&typeof entry==='object'){
     const validRaw=entry.raw&&typeof entry.raw==='object'&&!Array.isArray(entry.raw)&&['o','s'].includes(entry.raw.f),raw=validRaw?entry.raw:null;
     this.cache.set(url,{...entry,raw,...(!raw?{etag:null,lastModified:null}:{}),history:Array.isArray(entry.history)?entry.history.filter(p=>p&&typeof p==='object').slice(-this.historyLimit).map(p=>({...p,candidates:Array.isArray(p.candidates)?p.candidates.slice(0,this.historyCandidates):[]})):[]});
    }}catch{}
   }
   for(const [url,entry] of (saved.retainedEntries||[]).slice(-this.maxEntries))try{assertOfficialUrl(url);if(entry&&typeof entry==='object')this.retainedEntries.set(url,{...entry,raw:null,etag:null,lastModified:null,history:Array.isArray(entry.history)?entry.history.filter(p=>p&&typeof p==='object').slice(-this.historyLimit).map(p=>({...p,candidates:Array.isArray(p.candidates)?p.candidates.slice(0,this.historyCandidates):[]})):[]});}catch{}
   for(const [key,points] of (saved.regionalHistories||[]).slice(-this.maxEntries)) {
    if(typeof key!=='string'||!Array.isArray(points))continue;
    const valid=points.filter(p=>p&&p.phase==='official'&&p.aggregation?.complete===true&&Array.isArray(p.aggregation.generations)&&Array.isArray(p.candidates)&&Number.isFinite(p.votesComputed)&&Number.isFinite(p.votesValid));
    this.regionalHistories.set(key,valid.slice(-this.historyLimit).map(p=>({...p,candidates:p.candidates.slice(0,this.historyCandidates)})));
   }
   this.trim(true);
  }catch(error){if(error.code!=='ENOENT')this.lastError='Cache local não pôde ser carregado.';}
 }
 persist() {
  if(!this.dataDir)return Promise.resolve();
  this.persistRevision++;
  this.persistWaiters ||= [];
  const promise=new Promise(resolve=>this.persistWaiters.push({revision:this.persistRevision,resolve}));
  if(!this.pendingPersist)this.startPersistence();
  return promise;
 }
 startPersistence() {
  this.pendingPersist=(async()=>{
   // Batch concurrent result/history updates, then serialize any change arriving
   // during an active write. Every caller awaits its durable final revision.
   await new Promise(resolve=>setTimeout(resolve,10));
   let written;
   do {
    written=this.persistRevision;this.trim(true);
    const body=JSON.stringify({version:1,cooldownUntil:this.cooldownUntil,entries:[...this.cache.entries()],retainedEntries:[...this.retainedEntries.entries()],regionalHistories:[...this.regionalHistories.entries()]});
    const digest=createHash('sha256').update(body).digest('hex');
    if(digest===this.lastPersisted)this.metrics.persistenceSkipped++;
    else {await mkdir(this.dataDir,{recursive:true});const target=join(this.dataDir,'tse-cache.json'),temporary=target+'.tmp';
     await writeFile(temporary,body);await rename(temporary,target);this.lastPersisted=digest;this.metrics.persistenceWrites++;}
    const completed=this.persistWaiters.filter(waiter=>waiter.revision<=written);this.persistWaiters=this.persistWaiters.filter(waiter=>waiter.revision>written);for(const waiter of completed)waiter.resolve();
   }while(written!==this.persistRevision);
  })().catch(()=>{this.lastError='Não foi possível persistir o cache local.';for(const waiter of this.persistWaiters)waiter.resolve();this.persistWaiters=[];}).finally(()=>{this.pendingPersist=null;if(this.persistWaiters.length)this.startPersistence();});
  this.persistChain=this.pendingPersist;
 }
 async flush(){await this.ready;while(this.pendingPersist)await this.pendingPersist;}
 validatedRaw(raw,validate,key) {
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
  if(!validate)return true;
  const memo=this.validated.get(raw)||new Set(),identity=key||validate;
  if(memo.has(identity)){this.metrics.validationHits++;return true;}
  if(!validate(raw))return false;memo.add(identity);while(memo.size>64)memo.delete(memo.values().next().value);this.validated.set(raw,memo);return true;
 }
 rawSize(raw){if(!raw||typeof raw!=='object')return 0;if(!this.rawSizes.has(raw))this.rawSizes.set(raw,Buffer.byteLength(JSON.stringify(raw)));return this.rawSizes.get(raw);}
 rawDigest(raw){if(!this.rawDigests.has(raw))this.rawDigests.set(raw,createHash('sha256').update(JSON.stringify(raw)).digest('hex'));return this.rawDigests.get(raw);}
 touch(url,entry){const map=this.cache.has(url)?this.cache:this.retainedEntries;if(map.has(url)){map.delete(url);map.set(url,entry);}}
 trim(checkHistory=false) {
  let bytes=[...this.cache.values()].reduce((total,e)=>total+this.rawSize(e.raw),0);
  while(this.cache.size>this.maxEntries||bytes>this.maxCacheBytes) {
   const url=this.cache.keys().next().value,entry=this.cache.get(url);bytes-=this.rawSize(entry.raw);this.cache.delete(url);
   this.retainedEntries.delete(url);this.retainedEntries.set(url,{...entry,raw:null,etag:null,lastModified:null});
  }
  while(this.retainedEntries.size>this.maxEntries)this.retainedEntries.delete(this.retainedEntries.keys().next().value);
  if(!checkHistory)return;
  const historyMaps=[this.retainedEntries,this.cache];
  const arrays=[...historyMaps.flatMap(map=>[...map.values()].map(e=>e.history||[])),...this.regionalHistories.values()];
  const points=arrays.flatMap(array=>array.map(point=>{if(!this.historySizes.has(point))this.historySizes.set(point,Buffer.byteLength(JSON.stringify(point)));return {array,point,bytes:this.historySizes.get(point)+1};}));
  let historyBytes=points.reduce((n,p)=>n+p.bytes,0)+arrays.length*2;
  // Keep newest observed points within the global history budget; no fabricated
  // replacement points are introduced by payload eviction.
  if(historyBytes>this.maxHistoryBytes)for(const oldest of points.sort((a,b)=>(a.point.observedAt||'').localeCompare(b.point.observedAt||''))){if(historyBytes<=this.maxHistoryBytes)break;oldest.array.splice(oldest.array.indexOf(oldest.point),1);historyBytes-=oldest.bytes;}
 }
 enqueue(job,{priority='data'}={}) {
  return new Promise((resolve,reject)=>{this.queue.push({job,resolve,reject,priority});this.pump();});
 }
 pump() {
  if(this.active>=3||!this.queue.length)return;
  const delay=this.minInterval-(this.now()-this.lastStart);
  if(delay>0){if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.pump();},delay);return;}
  const priorityIndex=this.queue.findIndex(task=>task.priority!=='photo');
  const task=this.queue.splice(priorityIndex>=0?priorityIndex:0,1)[0];this.active++;this.lastStart=this.now();
  Promise.resolve().then(task.job).then(task.resolve,task.reject).finally(()=>{this.active--;this.pump();});
  this.pump();
 }
 source(url,entry,state,message) {
  const raw=entry?.raw,warnings=[];
  if(raw&&generatedAt(raw))warnings.push(`Data de geração informada pelo TSE: ${str(raw.dg)} ${str(raw.hg)}; fuso não especificado no leiaute.`);
  if(raw?.f==='s')warnings.push('O TSE identificou este arquivo como simulado (f=s).');
  const next=Math.max(entry?.retryAt||0,this.cooldownUntil);
  return {state,url,phase:phase(raw),generatedAt:generatedAt(raw),generationId:str(raw?.idg)||null,fetchedAt:Number.isFinite(entry?.fetchedAt)?iso(entry.fetchedAt):null,checkedAt:Number.isFinite(entry?.checkedAt)?iso(entry.checkedAt):null,...(message?{message}:{}),...(entry?.httpStatus?{httpStatus:entry.httpStatus}:{}),nextRetryAt:next>this.now()?iso(next):null,warnings};
 }
 view(url,entry,state,message) { return {raw:entry?.raw||null,source:this.source(url,entry,state,message),entry}; }
 async get(url,{ttl=15000,validate,validationKey}={}) {
  assertOfficialUrl(url);await this.ready;
  let old=this.cache.get(url)||this.retainedEntries.get(url);if(old)this.touch(url,old);
  if(old?.raw&&!this.validatedRaw(old.raw,validate,validationKey)) {
   old={...old,raw:null,etag:null,lastModified:null,history:[],error:'Cache local não corresponde ao leiaute solicitado.'};this.store(url,old);
  }
  if(this.cooldownUntil>this.now())return this.view(url,old,old?.raw?'stale':'unavailable','TSE solicitou pausa de acesso. Aguardando o período de 10 minutos.');
  if(old?.retryAt>this.now())return this.view(url,old,old.raw?'stale':old.httpStatus===404?'waiting':'unavailable',old.error);
  if(old?.raw&&!old.failures&&(!old.error||old.olderGeneration)&&this.now()-old.checkedAt<ttl){this.metrics.cacheHits++;return this.view(url,old,old.olderGeneration?'stale':'cached',old.olderGeneration?old.error:undefined);}
  let promise=this.inflight.get(url);
  if(!promise){promise=this.enqueue(()=>this.request(url,validate,validationKey)).finally(()=>this.inflight.delete(url));this.inflight.set(url,promise);}
  const result=await promise;
  if(result.raw&&!this.validatedRaw(result.raw,validate,validationKey))return this.view(url,null,'unavailable','Arquivo não corresponde ao recorte solicitado.');
  return result;
 }
 async request(url,validate,validationKey) {
  const old=this.cache.get(url)||this.retainedEntries.get(url)||{history:[]};
  // A previous queued request may have activated the global cooldown.
  if(this.cooldownUntil>this.now())return this.view(url,old,old.raw?'stale':'unavailable','Pausa global de acesso ao TSE.');
  const headers={Accept:'application/json'};
  if(old.etag)headers['If-None-Match']=old.etag;
  if(old.lastModified)headers['If-Modified-Since']=old.lastModified;
  let response;
  try {
   this.requests++;
   response=await this.fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(this.timeout)});
   if(response.status===304&&old.raw) {
    const entry={...old,checkedAt:this.now(),retryAt:0,httpStatus:304,error:null,failures:0,olderGeneration:false};this.store(url,entry);await this.persist();return this.view(url,entry,'cached');
   }
   if(!response.ok)throw Object.assign(new Error(response.status===404?'Arquivo oficial ainda não disponível no TSE.':`TSE respondeu HTTP ${response.status}.`),{status:response.status});
   if(Number(response.headers.get('content-length'))>8*1024*1024)throw new Error('Arquivo TSE excede limite de tamanho.');
   let text='';
   if(response.body?.getReader) {
    const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8*1024*1024){await reader.cancel();throw new Error('Arquivo TSE excede limite de tamanho.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
   }else text=await response.text();
   if(Buffer.byteLength(text)>8*1024*1024)throw new Error('Arquivo TSE excede limite de tamanho.');
   let raw=JSON.parse(text);
   if(!raw||typeof raw!=='object'||Array.isArray(raw)||!['o','s'].includes(raw.f))throw new Error('Arquivo TSE possui formato desconhecido.');
   if(old.raw&&this.rawDigest(raw)===this.rawDigest(old.raw))raw=old.raw;
   if(!this.validatedRaw(raw,validate,validationKey))throw new Error('Estrutura do arquivo TSE não corresponde ao leiaute esperado.');
   const previousGeneration=generatedAt(old.raw),newGeneration=generatedAt(raw);
   if(old.raw&&phase(old.raw)===phase(raw)&&previousGeneration&&newGeneration&&newGeneration<previousGeneration) {
    const entry={...old,checkedAt:this.now(),httpStatus:response.status,retryAt:0,failures:0,olderGeneration:true,error:'CDN retornou geração anterior. Última geração observada foi preservada; IDG não foi usado para ordenar versões.'};
    this.store(url,entry);await this.persist();return this.view(url,entry,'stale',entry.error);
   }
   const entry={raw,fetchedAt:raw===old.raw?old.fetchedAt:this.now(),checkedAt:this.now(),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),retryAt:0,httpStatus:response.status,failures:0,history:old.history||[]};
   this.store(url,entry);await this.persist();return this.view(url,entry,'live');
  }catch(error) {
   const status=error.status||response?.status;
   const failures=(old.failures||0)+1;
   if(status===403||status===429)this.cooldownUntil=this.now()+600000;
   const wait=status===404?Math.min(1800000,60000*2**Math.min(failures-1,5)):status===403||status===429?600000:30000;
   const message=error.status?error.message:error.name==='TimeoutError'?'Tempo limite ao consultar o TSE.':'Falha de acesso ou arquivo TSE inválido; última versão preservada.';
   this.lastError=message;
   const entry={...old,checkedAt:this.now(),retryAt:this.now()+wait,httpStatus:status,error:message,failures};
   this.store(url,entry);await this.persist();return this.view(url,entry,old.raw?'stale':status===404?'waiting':'unavailable',message);
  }
 }
 store(url,entry) {
  this.retainedEntries.delete(url);this.cache.delete(url);this.cache.set(url,entry);this.trim();
 }
 async history(url,data,source) {
  const entry=this.cache.get(url);if(!entry?.raw)return [];
  const id=source.generationId||`${entry.raw.dg} ${entry.raw.hg}`;
  if(!entry.history.some(p=>p.id===id&&(p.phase||'official')===source.phase)) {
   const candidates=historyCandidates(data,this.historyCandidates);
   entry.history.push({id,phase:source.phase,candidatesTruncated:data.candidates.length>this.historyCandidates,generatedAt:source.generatedAt,observedAt:iso(this.now()),sectionsPercent:data.summary.sectionsPercent,votesValid:data.summary.votesValid,votesComputed:data.summary.votesComputed??null,candidates});
   entry.history=entry.history.slice(-this.historyLimit);this.trim(true);await this.persist();
  }else {
   // Only the currently loaded generation can enrich a legacy point. Older points
   // retain missing denominators and their original observed values.
   const current=entry.history.find(p=>p.id===id&&(p.phase||'official')===source.phase);let changed=false;
   for(const field of ['votesValid','votesComputed'])if(current[field]===undefined){current[field]=data.summary[field]??null;changed=true;}
   const candidates=new Map(data.candidates.map(c=>[c.id,c]));
   for(const candidate of current.candidates)for(const field of ['number','name','destination'])if(candidate[field]===undefined&&candidates.get(candidate.id)?.[field]!==undefined){candidate[field]=candidates.get(candidate.id)[field];changed=true;}
   if(changed){this.historySizes.delete(current);this.trim(true);await this.persist();}
  }
  return entry.history;
 }
 async regionalHistory(query,data,source,samples) {
  await this.ready;
  const key=regionalHistoryKey(query,source.aggregation.states),history=this.regionalHistories.get(key)||[];
  if(this.regionalHistories.has(key)){this.regionalHistories.delete(key);this.regionalHistories.set(key,history);}
  const previous=this.regionalVectors.get(key);
  if(previous&&source.phase==='official'&&source.aggregation.complete&&samples.every(s=>s.source.state!=='stale')&&samples.length===previous.refs.length&&samples.every((s,i)=>s.raw===previous.refs[i]?.deref())&&history.some(p=>p.id===previous.id))return history;
  const point=regionalHistoryPoint(query,data,source,samples,{now:this.now(),limit:this.historyCandidates});
  if(point){this.regionalVectors.delete(key);this.regionalVectors.set(key,{id:point.id,refs:samples.map(s=>new WeakRef(s.raw))});while(this.regionalVectors.size>this.maxEntries)this.regionalVectors.delete(this.regionalVectors.keys().next().value);}
  if(point&&!history.some(p=>p.id===point.id)&&!olderRegionalPoint(point,history.at(-1))) {
   history.push(point);this.regionalHistories.delete(key);this.regionalHistories.set(key,history.slice(-this.historyLimit));
   while(this.regionalHistories.size>this.maxEntries)this.regionalHistories.delete(this.regionalHistories.keys().next().value);
   this.trim(true);await this.persist();
  }
  return this.regionalHistories.get(key)||history;
 }
 health() {return {ok:true,service:'apura-brasil',pid:process.pid,uptime:Math.floor((this.now()-this.started)/1000),source:BASE,cacheEntries:this.cache.size,cacheBytes:[...this.cache.values()].reduce((n,e)=>n+this.rawSize(e.raw),0),cacheMetrics:{...this.metrics},inFlight:this.inflight.size,requests:this.requests,cooldownUntil:this.cooldownUntil>this.now()?iso(this.cooldownUntil):null,lastError:this.lastError,version:'1.0.0'};}
}
