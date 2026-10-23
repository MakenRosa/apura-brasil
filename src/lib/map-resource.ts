/** Scope-keyed cache: a prefetched preview never substitutes for an electoral map. */
export function createMapResource<T>(fetcher:(url:string,signal:AbortSignal,options?:{revalidate?:boolean})=>Promise<T>,limit=4,ttl=300000,now=()=>Date.now(),deadline?:(url:string)=>number){
 const ready=new Map<string,{data:T;expires:number}>();
 const pending=new Map<string,{promise:Promise<T>;controller:AbortController}>();
 function peek(key:string):T|null {
  const entry=ready.get(key);
  if(!entry)return null;
  if(now()>=entry.expires){ready.delete(key);return null;}
  ready.delete(key);ready.set(key,entry);
  return entry.data;
 }
 function load(key:string,url:string,revalidate=false):Promise<T>{
  const data=peek(key);if(data&&!revalidate)return Promise.resolve(data);
  const active=pending.get(key);if(active)return active.promise;
  const controller=new AbortController();
  const promise=fetcher(url,controller.signal,{revalidate}).then(data=>{
   if(!controller.signal.aborted){ready.set(key,{data,expires:deadline?deadline(url):now()+ttl});while(ready.size>limit)ready.delete(ready.keys().next().value!);}
   return data;
  }).finally(()=>{if(pending.get(key)?.controller===controller)pending.delete(key);});
  pending.set(key,{promise,controller});
  return promise;
 }
 function invalidate(key:string){ready.delete(key);pending.get(key)?.controller.abort();pending.delete(key);}
 function clear(){for(const entry of pending.values())entry.controller.abort();pending.clear();ready.clear();}
 return {peek,load,invalidate,clear};
}

/** Reveal only after the same navigation has finished both zoom and cartography. */
export function createMapEntry(){
 let active:{zoom:boolean;map:boolean;complete:()=>void}|null=null;
 function cancel(){active=null;}
 function begin(complete:()=>void){
  const entry={zoom:false,map:false,complete};active=entry;
  const finish=(part:'zoom'|'map')=>{if(active!==entry)return;entry[part]=true;if(entry.zoom&&entry.map){active=null;entry.complete();}};
  return {zoomReady:()=>finish('zoom'),mapReady:()=>finish('map')};
 }
 return {begin,cancel};
}
