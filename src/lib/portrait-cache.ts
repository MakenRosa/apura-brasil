/** No image downloads are performed here. Only failed URLs get a bounded retry deadline. */
export function createPortraitFailureCache(ttl=60000,limit=128,now=()=>Date.now()){
 const failures=new Map<string,number>();
 function retryAt(url:string){const deadline=failures.get(url)||0;return deadline>now()?deadline:0;}
 function fail(url:string){const existing=retryAt(url);if(existing)return existing;const deadline=now()+ttl;failures.set(url,deadline);while(failures.size>limit)failures.delete(failures.keys().next().value!);return deadline;}
 return {retryAt,fail,hasFailure:(url:string)=>failures.has(url),succeed:(url:string)=>failures.delete(url),size:()=>failures.size};
}
export const portraitFailures=createPortraitFailureCache();
