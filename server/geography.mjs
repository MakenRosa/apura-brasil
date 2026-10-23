import {readFile,writeFile,mkdir,rename,stat,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {STATES} from './constants.mjs';

export const IBGE_BASE='https://servicodados.ibge.gov.br';
export const GEOGRAPHY_TTL=30*86400000;
const stateFor=uf=>STATES.find(state=>state.uf===uf);
export function parsePreviewUf(searchParams) {
 if([...searchParams.keys()].some(key=>key!=='uf')||searchParams.getAll('uf').length!==1)throw Object.assign(new Error('Prévia geográfica aceita somente uma UF brasileira.'),{status:400});
 const uf=searchParams.get('uf').toLowerCase();geographyUrls(uf);return uf;
}
export function geographyUrls(uf) {
 const state=stateFor(uf);if(!state)throw Object.assign(new Error('Cartografia municipal exige uma UF brasileira.'),{status:400});
 return {geometry:`${IBGE_BASE}/api/v3/malhas/estados/${state.ibge}?intrarregiao=municipio&formato=application/vnd.geo+json&qualidade=minima`,localities:`${IBGE_BASE}/api/v1/localidades/estados/${state.ibge}/municipios`};
}
export function assertIbgeUrl(url) {
 const parsed=new URL(url);
 if(parsed.origin!==IBGE_BASE||parsed.username||parsed.password||parsed.hash)throw new Error('URL cartográfica fora da origem IBGE permitida.');
 const allowed=STATES.some(state=>Object.values(geographyUrls(state.uf)).includes(parsed.href));
 if(!allowed)throw new Error('Rota cartográfica IBGE não permitida.');
 return parsed.href;
}
export const normalizedName=name=>String(name||'').normalize('NFD').replace(/\p{M}/gu,'').toLocaleLowerCase('pt-BR').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
export function normalizeGeography(raw,uf) {
 const state=stateFor(uf);if(!state||raw?.type!=='FeatureCollection'||!Array.isArray(raw.features)||!raw.features.length||raw.features.length>6000)throw new Error('Malha IBGE inválida.');
 const codes=new Set();let points=0;
 const ring=value=>Array.isArray(value)&&value.length>=4&&value.every(p=>{
  points++;return points<=350000&&Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
 });
 const polygon=value=>Array.isArray(value)&&value.length>0&&value.every(ring);
 const features=raw.features.map(feature=>{
  const ibge=String(feature?.properties?.codarea||'');
  if(!/^\d{7}$/.test(ibge)||!ibge.startsWith(state.ibge)||codes.has(ibge))throw new Error('Identificadores IBGE inconsistentes com a UF.');
  codes.add(ibge);const geometry=feature.geometry;
  if(feature.type!=='Feature'||!geometry||(geometry.type==='Polygon'?!polygon(geometry.coordinates):geometry.type==='MultiPolygon'?!Array.isArray(geometry.coordinates)||!geometry.coordinates.length||!geometry.coordinates.every(polygon):true))throw new Error('Geometria municipal IBGE inválida.');
  return {type:'Feature',properties:{codarea:ibge},geometry:{type:geometry.type,coordinates:geometry.coordinates}};
 });
 return {type:'FeatureCollection',features};
}
export function normalizeLocalities(raw,uf) {
 const state=stateFor(uf);if(!state||!Array.isArray(raw)||!raw.length||raw.length>6000)throw new Error('Localidades IBGE inválidas.');
 const ids=new Set();
 return raw.map(row=>{
  const id=String(row.id),name=String(row.nome||'').trim();
  if(!/^\d{7}$/.test(id)||!id.startsWith(state.ibge)||!name||ids.has(id))throw new Error('Cadastro IBGE inconsistente com a UF.');
  ids.add(id);return {id,nome:name};
 });
}
const add=(map,key,row)=>{if(!key)return;const rows=map.get(key)||[];rows.push(row);map.set(key,rows);};
export function linkMunicipalities(collection,localities,municipalities,uf) {
 const names=new Map(localities.map(row=>[row.id,row.nome])),ibgeIndex=new Map(),tseNames=new Map(),ibgeNames=new Map(),warnings=[];
 for(const row of localities)add(ibgeNames,normalizedName(row.nome),row);
 for(const municipality of municipalities) {
  if(municipality.uf!==uf||!/^\d{5}$/.test(municipality.id))continue;
  if(/^\d{7}$/.test(municipality.ibge||''))add(ibgeIndex,municipality.ibge,municipality);
  else add(tseNames,normalizedName(municipality.name),municipality);
 }
 const used=new Map();let ambiguous=0,fallback=0,nameDifferences=0;
 const features=collection.features.map(feature=>{
  const ibge=String(feature.properties.codarea),name=names.get(ibge)||`Município IBGE ${ibge}`;
  const exact=ibgeIndex.get(ibge)||[];let match=null;
  if(exact.length===1)match=exact[0];else if(exact.length>1)ambiguous++;
  else if(names.has(ibge)) {
   const key=normalizedName(name),byName=tseNames.get(key)||[];
   if(byName.length===1&&ibgeNames.get(key)?.length===1){match=byName[0];fallback++;}
   else if(byName.length>1||byName.length&&ibgeNames.get(key)?.length>1)ambiguous++;
  }
  if(match&&normalizedName(match.name)!==normalizedName(name))nameDifferences++;
  const result={type:'Feature',properties:{ibge,name,tseId:match?.id||null},geometry:feature.geometry};
  if(match)add(used,match.id,result);return result;
 });
 for(const matches of used.values())if(matches.length>1){ambiguous+=matches.length;for(const feature of matches)feature.properties.tseId=null;}
 const linked=features.filter(f=>f.properties.tseId!==null).length,total=features.length;
 const linkedIds=new Set(features.map(f=>f.properties.tseId).filter(Boolean));
 const missingGeometry=new Set(municipalities.filter(m=>m.uf===uf&&!linkedIds.has(m.id)).map(m=>m.id)).size;
 if(ambiguous)warnings.push(`${ambiguous} correspondências ambíguas foram mantidas sem código TSE.`);
 if(fallback)warnings.push(`${fallback} municípios vinculados por nome normalizado e único dentro da UF, sem aproximação de nomes.`);
 if(nameDifferences)warnings.push(`${nameDifferences} nomes diferem entre IBGE e TSE; vínculo confirmado pelo código IBGE completo.`);
 if(total-linked)warnings.push(`${total-linked} de ${total} municípios da malha não possuem correspondência única nesta eleição TSE.`);
 if(missingGeometry)warnings.push(`${missingGeometry} municípios participantes do TSE não possuem polígono com correspondência única nesta malha IBGE.`);
 return {collection:{type:'FeatureCollection',features},coverage:{total,linked,unmatched:total-linked},warnings};
}
export class GeographyClient {
 constructor({fetchImpl=globalThis.fetch,dataDir=null,now=Date.now,ttl=GEOGRAPHY_TTL,timeout=25000,maxBytes=8*1024*1024,minInterval=350,maxEntries=6,maxCacheBytes=32*1024*1024,maxDiskBytes=128*1024*1024}={}) {
  Object.assign(this,{fetchImpl,dataDir,now,ttl,timeout,maxBytes,minInterval,maxEntries,maxCacheBytes,maxDiskBytes});this.cache=new Map();this.inflight=new Map();this.queue=[];this.active=0;this.lastStart=-Infinity;this.cooldownUntil=0;this.entrySizes=new WeakMap();this.writeChains=new Map();this.diskAccess=new Map();this.persistDigests=new Map();this.metrics={cacheHits:0,diskReads:0,normalizations:0,persistenceWrites:0,conditionalHits:0};this.ready=this.restoreControl();
 }
 async restoreControl(){if(!this.dataDir)return;try{const file=join(this.dataDir,'ibge-control.json');if((await stat(file)).size>4096)return;const saved=JSON.parse(await readFile(file,'utf8'));if(saved.version===1&&Number.isFinite(saved.cooldownUntil))this.cooldownUntil=saved.cooldownUntil;}catch{}}
 async load(uf) {
  this.diskAccess.set(uf,this.now());
  if(this.cache.has(uf)){const entry=this.cache.get(uf);this.cache.delete(uf);this.cache.set(uf,entry);return entry;}
  if(this.dataDir)try {
   const path=join(this.dataDir,`${uf}.json`);if((await stat(path)).size>this.maxBytes*2+10000)throw new Error('Cache excede limite.');
   const entry=JSON.parse(await readFile(path,'utf8'));this.metrics.diskReads++;
   if(entry.version!==1||!Number.isFinite(entry.retrievedAt))throw new Error('Cache inválido.');
   if(entry.collection){entry.collection=normalizeGeography(entry.collection,uf);entry.localities=normalizeLocalities(entry.localities,uf);this.metrics.normalizations++;
    const names=new Set(entry.localities.map(row=>row.id));if(entry.collection.features.some(f=>!names.has(f.properties.codarea)))throw new Error('Cache com nomes incompletos.');}
   else if(!Number.isFinite(entry.retryAt))throw new Error('Cache negativo inválido.');
   this.store(uf,entry);return entry;
  }catch{}
  return null;
 }
 size(entry){if(!this.entrySizes.has(entry))this.entrySizes.set(entry,Buffer.byteLength(JSON.stringify(entry)));return this.entrySizes.get(entry);}
 store(uf,entry){this.cache.delete(uf);this.cache.set(uf,entry);let bytes=[...this.cache.values()].reduce((n,e)=>n+this.size(e),0);while(this.cache.size>this.maxEntries||bytes>this.maxCacheBytes){const first=this.cache.keys().next().value;bytes-=this.size(this.cache.get(first));this.cache.delete(first);}}
 async persist(uf,entry) {
  if(!this.dataDir)return;
  const chain=(this.persistChain||Promise.resolve()).catch(()=>{}).then(async()=>{
   try{await mkdir(this.dataDir,{recursive:true});const body=JSON.stringify(entry),digest=createHash('sha256').update(body).digest('hex');if(this.persistDigests.get(uf)===digest)return;
    const file=join(this.dataDir,`${uf}.json`);await writeFile(file+'.tmp',body);await rename(file+'.tmp',file);this.persistDigests.set(uf,digest);this.metrics.persistenceWrites++;
    if(this.cooldownUntil>this.now()){const control=join(this.dataDir,'ibge-control.json');await writeFile(control+'.tmp',JSON.stringify({version:1,cooldownUntil:this.cooldownUntil}));await rename(control+'.tmp',control);}
    // Only recognized UF cache files may be pruned. No network enumeration occurs.
    const files=(await Promise.all(STATES.map(async state=>{const path=join(this.dataDir,`${state.uf}.json`);try{const info=await stat(path);return {path,uf:state.uf,size:info.size,time:this.diskAccess.get(state.uf)??info.mtimeMs};}catch{return null;}}))).filter(Boolean).sort((a,b)=>a.time-b.time);
    let bytes=files.reduce((n,file)=>n+file.size,0);for(const file of files){if(bytes<=this.maxDiskBytes)break;await unlink(file.path);bytes-=file.size;this.persistDigests.delete(file.uf);}
   }catch{entry.warning='Não foi possível persistir a cartografia em disco.';await unlink(join(this.dataDir,`${uf}.json.tmp`)).catch(()=>{});await unlink(join(this.dataDir,'ibge-control.json.tmp')).catch(()=>{});}
  });this.persistChain=chain;this.writeChains.set(uf,chain);await chain;
 }
 async flush(){await this.ready;let chain;do{chain=this.persistChain;await chain;}while(chain!==this.persistChain);}
 schedule(job){return new Promise((resolve,reject)=>{this.queue.push({job,resolve,reject});this.pump();});}
 pump(){
  if(this.active>=2||!this.queue.length)return;
  const delay=this.minInterval-(this.now()-this.lastStart);
  if(delay>0){if(!this.timer)this.timer=setTimeout(()=>{this.timer=null;this.pump();},delay);return;}
  const task=this.queue.shift();this.active++;this.lastStart=this.now();Promise.resolve().then(task.job).then(task.resolve,task.reject).finally(()=>{this.active--;this.pump();});this.pump();
 }
 async download(url,{cached,validators}={}) {
  assertIbgeUrl(url);
  if(this.cooldownUntil>this.now())throw new Error('IBGE em pausa temporária de acesso.');
  const headers={Accept:'application/json, application/vnd.geo+json'};if(cached&&validators?.etag)headers['If-None-Match']=validators.etag;if(cached&&validators?.lastModified)headers['If-Modified-Since']=validators.lastModified;
  const response=await this.fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(this.timeout)});
  if(response.status===304&&cached){this.metrics.conditionalHits++;return {raw:cached,unchanged:true,validators};}
  if(!response.ok){if([403,429].includes(response.status))this.cooldownUntil=this.now()+600000;throw new Error(`IBGE respondeu HTTP ${response.status}.`);}
  if(Number(response.headers.get('content-length'))>this.maxBytes)throw new Error('Resposta IBGE excede limite de tamanho.');
  let body='';if(response.body?.getReader){const reader=response.body.getReader(),decoder=new TextDecoder();let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>this.maxBytes){await reader.cancel();throw new Error('Resposta IBGE excede limite de tamanho.');}body+=decoder.decode(value,{stream:true});}body+=decoder.decode();
  }else{body=await response.text();if(Buffer.byteLength(body)>this.maxBytes)throw new Error('Resposta IBGE excede limite de tamanho.');}
  return {raw:JSON.parse(body),unchanged:false,validators:{etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified')}};
 }
 view(uf,entry,state,message) {
  const urls=geographyUrls(uf),warnings=[`Malha simplificada municipal: IBGE API v3. Nomes oficiais: ${urls.localities}`];if(entry?.warning)warnings.push(entry.warning);
  const retry=Math.max(entry?.retryAt||0,this.cooldownUntil);
  return {collection:entry?.collection||null,localities:entry?.localities||[],geography:{state,provider:'IBGE',url:urls.geometry,retrievedAt:entry?.retrievedAt?new Date(entry.retrievedAt).toISOString():null,nextRetryAt:retry>this.now()?new Date(retry).toISOString():null,...(message?{message}:{}),warnings}};
 }
 get(uf) {
  geographyUrls(uf);if(this.inflight.has(uf))return this.inflight.get(uf);
  const promise=this.obtain(uf).finally(()=>this.inflight.delete(uf));this.inflight.set(uf,promise);return promise;
 }
 async obtain(uf) {
  await this.ready;
  const old=await this.load(uf);
  if(old?.retryAt>this.now()||this.cooldownUntil>this.now())return this.view(uf,old,old?.collection?'stale':'unavailable',old?.error||'IBGE em pausa temporária de acesso.');
  if(old?.collection&&!old.error&&this.now()-(old.checkedAt??old.retrievedAt)<this.ttl){this.metrics.cacheHits++;return this.view(uf,old,'cached');}
  const urls=geographyUrls(uf);
  try {
   const [raw,localities]=await Promise.all([this.schedule(()=>this.download(urls.geometry,{cached:old?.collection,validators:old?.validators?.geometry})),this.schedule(()=>this.download(urls.localities,{cached:old?.localities,validators:old?.validators?.localities}))]);
   const collection=raw.unchanged?raw.raw:normalizeGeography(raw.raw,uf),namesList=localities.unchanged?localities.raw:normalizeLocalities(localities.raw,uf);if(!raw.unchanged||!localities.unchanged)this.metrics.normalizations++;
   const entry={version:1,collection,localities:namesList,retrievedAt:raw.unchanged&&localities.unchanged?old.retrievedAt:this.now(),checkedAt:this.now(),validators:{geometry:raw.validators,localities:localities.validators},retryAt:0};
   // Require one name for each municipal geometry; partial metadata never invents names.
   const names=new Set(entry.localities.map(row=>row.id));if(entry.collection.features.some(f=>!names.has(f.properties.codarea)))throw new Error('IBGE retornou malha e cadastro municipal sem alinhamento completo.');
   this.store(uf,entry);await this.persist(uf,entry);return this.view(uf,entry,raw.unchanged&&localities.unchanged?'cached':'live');
  }catch(error){const entry={version:1,retrievedAt:0,...old,checkedAt:this.now(),retryAt:Math.max(this.now()+300000,this.cooldownUntil),error:error.name==='TimeoutError'?'Tempo limite ao consultar a cartografia IBGE.':error.message};this.store(uf,entry);await this.persist(uf,entry);return this.view(uf,entry,old?.collection?'stale':'unavailable',entry.error);}
 }
}
export class MunicipalMapService {
 constructor(elections,geography){this.elections=elections;this.geography=geography;this.pending=new Map();this.derived=new Map();this.metrics={mapBuilds:0,mapHits:0};}
 materialize(key,refs,compute) {
  let record=this.derived.get(key);
  if(record&&refs.every((ref,i)=>ref===record.refs[i])){this.metrics.mapHits++;this.derived.delete(key);this.derived.set(key,record);return record.value;}
  const value=compute();this.metrics.mapBuilds++;record={refs,value,bytes:Buffer.byteLength(JSON.stringify(value))};this.derived.delete(key);this.derived.set(key,record);
  let bytes=[...this.derived.values()].reduce((n,r)=>n+r.bytes,0);while(this.derived.size>6||bytes>16*1024*1024){const oldest=this.derived.keys().next().value;bytes-=this.derived.get(oldest).bytes;this.derived.delete(oldest);}return value;
 }
 async coalesce(key,compute) {
  if(!this.pending.has(key))this.pending.set(key,Promise.resolve().then(compute).finally(()=>this.pending.delete(key)));
  return structuredClone(await this.pending.get(key));
 }
 async preview(uf) {
  return this.coalesce(`preview:${uf}`,()=>this.previewData(uf));
 }
 async previewData(uf) {
  geographyUrls(uf);
  // Geographic exploration is independent of election configuration. This route
  // intentionally never resolves EA11, EA12 or EA20 or assigns electoral codes.
  const response=await this.geography.get(uf);
  const previewMessage='Prévia geográfica para o segundo turno enquanto o cadastro eleitoral não está disponível nesta visualização. Sem vínculos TSE ou dados de votação.';
  if(!response.collection)return {uf,collection:null,geography:{...response.geography,warnings:[...response.geography.warnings,previewMessage]},coverage:{total:0,linked:0,unmatched:0},municipalitiesSource:null};
  const collection=this.materialize(`preview:${uf}`,[response.collection,response.localities],()=>{
   const names=new Map(response.localities.map(row=>[row.id,row.nome]));
   return {type:'FeatureCollection',features:response.collection.features.map(feature=>({type:'Feature',properties:{ibge:feature.properties.codarea,name:names.get(feature.properties.codarea),tseId:null},geometry:feature.geometry}))};
  });
  return {uf,collection,geography:{...response.geography,...(!response.geography.message?{message:previewMessage}:{}),warnings:[...response.geography.warnings,previewMessage]},coverage:{total:collection.features.length,linked:0,unmatched:collection.features.length},municipalitiesSource:null};
 }
 async map(query) {
  const key=JSON.stringify([query.cycle,query.turn,query.office,query.uf,query.municipality||'',query.electionId||'',query.region||'']);
  return this.coalesce(`map:${key}`,()=>this.mapData(query));
 }
 async mapData(query) {
  if(['br','zz'].includes(query.uf))return {uf:query.uf,collection:null,geography:{state:'unavailable',provider:'IBGE',url:null,retrievedAt:null,message:query.uf==='br'?'Selecione uma UF para explorar a malha dos municípios brasileiros.':'Exterior não possui malha de municípios brasileiros nesta fonte IBGE.',warnings:[]},coverage:{total:0,linked:0,unmatched:0},municipalitiesSource:null};
  const resolved=await this.elections.resolve(query);
  const [geography,municipal]=await Promise.all([this.geography.get(query.uf),this.elections.municipalitiesFor(resolved)]);
  if(query.municipality&&municipal.raw&&!municipal.municipalities.some(m=>m.id===query.municipality))throw Object.assign(new Error('Município não participa desta eleição no arquivo EA12.'),{status:400});
  if(!geography.collection)return {uf:query.uf,collection:null,geography:geography.geography,coverage:{total:0,linked:0,unmatched:0},municipalitiesSource:municipal.source};
  const linked=this.materialize(`map:${query.uf}:${resolved.election.id}:${query.office}`,[geography.collection,geography.localities,municipal.raw,resolved.config.raw],()=>linkMunicipalities(geography.collection,geography.localities,municipal.municipalities,query.uf));
  return {uf:query.uf,collection:linked.collection,geography:{...geography.geography,warnings:[...geography.geography.warnings,...linked.warnings,...(!municipal.raw?['EA12 indisponível: os polígonos não foram vinculados a códigos TSE.']:[])]},coverage:linked.coverage,municipalitiesSource:municipal.source};
 }
}
