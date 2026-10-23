export type JSONReadOptions={revalidate?:boolean};
type CacheEntry={value:unknown;expires:number;retainUntil:number;bytes:number;etag?:string};
type Flight={promise:Promise<unknown>;controller:AbortController;consumers:number;settled:boolean};
type CacheConfig={fetcher?:typeof fetch;now?:()=>number;maxEntries?:number;maxBytes?:number;maxInflight?:number};
const BASE='http://apura.local';

export function clientCacheKey(url:string):string {
 const parsed=new URL(url,BASE);
 const entries=[...parsed.searchParams.entries()].map(([key,value])=>[key,key==='uf'?value.toLowerCase():value] as [string,string]).sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
 return `${parsed.origin}${parsed.pathname}?${new URLSearchParams(entries)}`;
}
export function clientCacheTTL(url:string):number {
 const parsed=new URL(url,BASE),path=parsed.pathname;
 if(['/api/results','/api/regions','/api/map','/api/municipalities'].includes(path)&&!parsed.searchParams.get('electionId'))return 0;
 if(path==='/api/bootstrap')return 60000;
 if(path==='/api/results'||path==='/api/regions')return 5000;
 if(path==='/api/health')return 2000;
 if(path==='/api/municipalities'||path==='/api/map')return 300000;
 if(path==='/api/map-preview')return 900000;
 if(path.endsWith('.geojson')||path==='/map-source.json')return 1800000;
 return 0;
}
const abortError=()=>new DOMException('A consulta foi cancelada.','AbortError');

/** In-memory only. A subscriber owns its cancellation, not the shared transport. */
export function createClientJSONCache({fetcher=fetch,now=()=>Date.now(),maxEntries=64,maxBytes=24*1024*1024,maxInflight=24}:CacheConfig={}){
 const ready=new Map<string,CacheEntry>(),pending=new Map<string,Flight>();
 let bytes=0;
 const counters={network:0,hits:0,joined:0,notModified:0,evicted:0};
 function remove(key:string){const entry=ready.get(key);if(entry){bytes-=entry.bytes;ready.delete(key);}}
 function usable(key:string){const entry=ready.get(key);if(entry&&now()>=entry.retainUntil){remove(key);return undefined;}return entry;}
 function touch(key:string,entry:CacheEntry){ready.delete(key);ready.set(key,entry);}
 function store(key:string,value:unknown,ttl:number,etag?:string){
  if(value&&typeof value==='object'){
   const object=value as Record<string,unknown>;
   for(const meta of [object.source,object.status,object.geography,object.municipalitiesSource]){
    if(!meta||typeof meta!=='object')continue;
    const state=(meta as {state?:string}).state;
    if(state==='waiting'||state==='unavailable')ttl=0;
    const retry=(meta as {nextRetryAt?:string}).nextRetryAt;
    if(retry&&Number.isFinite(Date.parse(retry)))ttl=Math.min(ttl,Math.max(0,Date.parse(retry)-now()));
   }
   if('collection'in object&&!object.collection)ttl=0;
  }
  remove(key);
  if(!ttl)return;
  const size=JSON.stringify(value).length*2;
  if(size>maxBytes)return;
  const at=now();const entry={value,expires:at+ttl,retainUntil:at+Math.max(ttl*2,600000),bytes:size,etag};
  ready.set(key,entry);bytes+=size;
  while(ready.size>maxEntries||bytes>maxBytes){remove(ready.keys().next().value!);counters.evicted++;}
 }
 function subscribe<T>(flight:Flight,signal?:AbortSignal):Promise<T>{
  flight.consumers++;
  return new Promise((resolve,reject)=>{
   let released=false;
   const release=()=>{if(released)return;released=true;signal?.removeEventListener('abort',abort);flight.consumers--;if(!flight.settled&&!flight.consumers){flight.controller.abort();for(const [key,active]of pending)if(active===flight)pending.delete(key);}};
   const abort=()=>{release();reject(abortError());};
   signal?.addEventListener('abort',abort,{once:true});
   if(signal?.aborted)abort();
   flight.promise.then(value=>{if(!released){release();resolve(value as T);}},error=>{if(!released){release();reject(error);}});
  });
 }
 function read<T>(url:string,signal?:AbortSignal,{revalidate=false}:JSONReadOptions={}):Promise<T>{
  if(signal?.aborted)return Promise.reject(abortError());
  const key=clientCacheKey(url),active=pending.get(key);
  if(active){counters.joined++;return subscribe<T>(active,signal);}
  const cached=usable(key);
  if(cached&&now()<cached.expires&&!revalidate){touch(key,cached);counters.hits++;return Promise.resolve(cached.value as T);}
  if(pending.size>=maxInflight)return Promise.reject(new Error('Muitas consultas locais simultâneas; tente novamente em instantes.'));
  const controller=new AbortController();
  const flight:Flight={controller,consumers:0,settled:false,promise:Promise.resolve()};
  pending.set(key,flight);
  counters.network++;
  flight.promise=(async()=>{
   const api=new URL(url,BASE).pathname.startsWith('/api/');
   const response=await fetcher(url,{signal:controller.signal,cache:api||revalidate?'no-cache':'default',headers:cached?.etag?{'If-None-Match':cached.etag}:undefined});
   let value:unknown;
   if(response.status===304&&cached){value=cached.value;counters.notModified++;}
   else {if(!response.ok){const details=await response.json().catch(()=>null) as {error?:string;source?:{message?:string}}|null;throw new Error(details?.error||details?.source?.message||`O serviço local respondeu ${response.status}.`);}value=await response.json();}
   // A late aborted request cannot write over a newer request for the same key.
   if(!controller.signal.aborted&&pending.get(key)===flight)store(key,value,clientCacheTTL(url),response.status===304?response.headers.get('etag')||cached?.etag:response.headers.get('etag')||undefined);
   return value;
  })().finally(()=>{flight.settled=true;if(pending.get(key)===flight)pending.delete(key);});
  return subscribe<T>(flight,signal);
 }
 function peek<T>(url:string,{allowStale=false,markStale=false}:{allowStale?:boolean;markStale?:boolean}={}):T|null{
  const key=clientCacheKey(url),entry=usable(key);if(!entry)return null;
  const expired=now()>=entry.expires;if(expired&&!allowStale)return null;
  touch(key,entry);
  if(!expired&&!markStale)return entry.value as T;
  const value=entry.value;
  if(!value||typeof value!=='object')return value as T;
  const object=value as Record<string,unknown>;
  const stale=(meta:unknown)=>meta&&typeof meta==='object'?{...meta,state:'stale',message:'Última resposta no cache local; aguardando revalidação. '+((meta as {message?:string}).message||'')}:meta;
  return {...object,...(object.source?{source:stale(object.source)}:{}),...(object.status?{status:stale(object.status)}:{}),...(object.geography?{geography:stale(object.geography)}:{}),...(object.municipalitiesSource?{municipalitiesSource:stale(object.municipalitiesSource)}:{})} as T;
 }
 function invalidate(url:string){remove(clientCacheKey(url));}
 function clear(){ready.clear();bytes=0;for(const flight of pending.values())flight.controller.abort();pending.clear();}
 return {read,peek,invalidate,clear,deadline:(url:string)=>usable(clientCacheKey(url))?.expires??0,stats:()=>({...counters,entries:ready.size,bytes,inflight:pending.size})};
}

export const clientJSONCache=createClientJSONCache();
