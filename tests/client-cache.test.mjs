import test from 'node:test';
import assert from 'node:assert/strict';
import {createClientJSONCache,clientCacheKey,clientCacheTTL} from '../src/lib/client-cache.ts';
import {createMapResource} from '../src/lib/map-resource.ts';
import {createPortraitFailureCache} from '../src/lib/portrait-cache.ts';
const url='/api/results?cycle=ele2026&turn=1&office=1&uf=br&electionId=2026';
const reply=(value,etag)=>new Response(JSON.stringify(value),{headers:etag?{etag}:{}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const body={data:{value:1},source:{state:'live',phase:'official',generatedAt:'2026-10-04T18:00:00',fetchedAt:'2026-10-04T21:00:00Z',checkedAt:'2026-10-04T21:00:00Z'}};

test('canonical full identities normalize parameter order/UF and isolate every electoral dimension and endpoint',()=>{
 assert.equal(clientCacheKey(url),clientCacheKey('/api/results?uf=BR&electionId=2026&office=1&turn=1&cycle=ele2026'));
 for(const change of ['turn=2','office=3','uf=sp','cycle=ele2024','electionId=2027']){const key=change.split('=')[0];const next=new URL(url,'http://apura.local');next.searchParams.set(key,change.split('=')[1]);assert.notEqual(clientCacheKey(url),clientCacheKey(next.href));}
 for(const suffix of ['&municipality=71072','&region=Sul'])assert.notEqual(clientCacheKey(url),clientCacheKey(url+suffix));
 assert.notEqual(clientCacheKey('/api/map-preview?uf=sp'),clientCacheKey('/api/map?uf=sp'));
 assert.notEqual(clientCacheKey(url),clientCacheKey(url.replace('results','regions')));
 assert.equal(clientCacheTTL('/api/results?turn=1&uf=br'),0);
});
test('TTL hits reuse original source times, expiration revalidates, stale peek labels without mutation',async()=>{
 let now=0,calls=0;const cache=createClientJSONCache({now:()=>now,fetcher:async()=>{calls++;return reply(body);}});
 const first=await cache.read(url);now=4999;assert.equal(await cache.read(url),first);assert.equal(calls,1);
 now=5000;assert.equal(cache.peek(url),null);const stale=cache.peek(url,{allowStale:true});assert.equal(stale.source.state,'stale');assert.equal(stale.source.checkedAt,body.source.checkedAt);assert.equal(first.source.state,'live');
 await cache.read(url);assert.equal(calls,2);
});
test('12 overlapping consumers plus fresh revisits need only one transport instead of 15',async()=>{
 let calls=0;const pending=deferred();const cache=createClientJSONCache({fetcher:()=>{calls++;return pending.promise;}});
 const consumers=Array.from({length:12},()=>cache.read(url));assert.equal(calls,1);pending.resolve(reply(body));await Promise.all(consumers);
 await Promise.all(Array.from({length:3},()=>cache.read(url)));assert.equal(calls,1);assert.equal(cache.stats().joined,11);assert.equal(cache.stats().hits,3);
});
test('cancelling one consumer does not cancel another sharing the transport',async()=>{
 const pending=deferred();let signal;const cache=createClientJSONCache({fetcher:(_url,options)=>{signal=options.signal;return pending.promise;}});
 const controller=new AbortController();const cancelled=cache.read(url,controller.signal);const survivor=cache.read(url);controller.abort();await assert.rejects(cancelled,{name:'AbortError'});assert.equal(signal.aborted,false);
 pending.resolve(reply(body));assert.deepEqual(await survivor,body);
});
test('last consumer cancellation aborts transport; late completion cannot overwrite a newer same-key result',async()=>{
 const slow=deferred();let calls=0,oldSignal;const cache=createClientJSONCache({fetcher:(_url,options)=>{calls++;if(calls===1){oldSignal=options.signal;return slow.promise;}return Promise.resolve(reply({value:'new'}));}});
 const controller=new AbortController();const old=cache.read(url,controller.signal);controller.abort();await assert.rejects(old,{name:'AbortError'});assert.equal(oldSignal.aborted,true);
 assert.deepEqual(await cache.read(url),{value:'new'});slow.resolve(reply({value:'old'}));await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(cache.peek(url),{value:'new'});
});
test('manual revalidation bypasses only local freshness, deduplicates and does not add a TSE force flag',async()=>{
 let calls=0,lastUrl,lastOptions;const pending=deferred();const cache=createClientJSONCache({fetcher:(next,options)=>{lastUrl=next;lastOptions=options;if(++calls===1)return Promise.resolve(reply({value:'old'}));return pending.promise;}});
 await cache.read(url);const a=cache.read(url,undefined,{revalidate:true});const b=cache.read(url,undefined,{revalidate:true});assert.equal(calls,2);assert.equal(lastUrl,url);assert.equal(lastOptions.cache,'no-cache');
 pending.resolve(reply({value:'new'}));assert.deepEqual(await a,{value:'new'});assert.deepEqual(await b,{value:'new'});await cache.read(url);assert.equal(calls,2);
});
test('ETag304 preserves exact metadata; a new 200 without ETag clears an older validator',async()=>{
 let requests=0;const headers=[];const cache=createClientJSONCache({fetcher:async(_url,options)=>{headers.push(options.headers);requests++;return requests===1?reply(body,'v1'):requests===2?new Response(null,{status:304}):reply({value:requests});}});
 await cache.read(url);assert.deepEqual(await cache.read(url,undefined,{revalidate:true}),body);assert.equal(headers[1]['If-None-Match'],'v1');assert.equal(cache.stats().notModified,1);
 await cache.read(url,undefined,{revalidate:true});await cache.read(url,undefined,{revalidate:true});assert.equal(headers[3],undefined);
});
test('LRU, byte size and inflight count stay bounded',async()=>{
 const cache=createClientJSONCache({maxEntries:2,maxBytes:100,fetcher:async next=>reply({value:next.endsWith('huge')?'x'.repeat(1000):'small'})});
 for(const id of ['a','b'])await cache.read(`/api/bootstrap?id=${id}`);cache.peek('/api/bootstrap?id=a');await cache.read('/api/bootstrap?id=c');assert.equal(cache.peek('/api/bootstrap?id=b'),null);assert.equal(cache.stats().entries,2);await cache.read('/api/bootstrap?id=huge');assert.equal(cache.stats().entries,2);assert.ok(cache.stats().bytes<=100);
 const pending=deferred();const limited=createClientJSONCache({maxInflight:1,fetcher:()=>pending.promise});const first=limited.read(url);await assert.rejects(limited.read('/api/health'),/simultâneas/);pending.resolve(reply(body));await first;
});
test('negative response replaces a positive entry; nextRetryAt limits TTL; ambiguous queries are not cached',async()=>{
 let now=0,calls=0;const cache=createClientJSONCache({now:()=>now,fetcher:async()=>reply(++calls===1?body:{data:null,source:{state:'waiting'}})});
 await cache.read(url);await cache.read(url,undefined,{revalidate:true});assert.equal(cache.peek(url,{allowStale:true}),null);
 const retry=createClientJSONCache({now:()=>now,fetcher:async()=>reply({...body,source:{...body.source,nextRetryAt:new Date(2500).toISOString()}})});await retry.read(url);assert.equal(retry.deadline(url),2500);now=2500;assert.equal(retry.peek(url),null);
 const ambiguous=url.replace('&electionId=2026','');await cache.read(ambiguous);assert.equal(cache.peek(ambiguous,{allowStale:true}),null);
});
test('network failure retains an explicit stale snapshot without inventing a check',async()=>{
 let calls=0;const cache=createClientJSONCache({fetcher:async()=>{if(++calls===1)return reply(body);throw new Error('offline');}});await cache.read(url);await assert.rejects(cache.read(url,undefined,{revalidate:true}),/offline/);const fallback=cache.peek(url,{allowStale:true,markStale:true});assert.equal(fallback.source.state,'stale');assert.equal(fallback.source.checkedAt,body.source.checkedAt);
});
test('map-resource uses the transport deadline, not a second fresh TTL',async()=>{
 let now=0,calls=0;const cache=createClientJSONCache({now:()=>now,fetcher:async()=>{calls++;return reply({collection:{type:'FeatureCollection',features:[]},geography:{state:'live'}});}});const mapUrl='/api/map?uf=sp&electionId=2026&turn=1&office=1&cycle=ele2026';await cache.read(mapUrl);now=299000;
 const maps=createMapResource((next,signal,options)=>cache.read(next,signal,options),4,300000,()=>now,next=>cache.deadline(next));await maps.load('sp',mapUrl);assert.equal(calls,1);now=300000;assert.equal(maps.peek('sp'),null);await maps.load('sp',mapUrl,true);assert.equal(calls,2);
});
test('portrait negative cache is bounded and multiple failed cards do not postpone retry indefinitely',()=>{
 let now=0;const photos=createPortraitFailureCache(60000,2,()=>now);assert.equal(photos.fail('a'),60000);now=30000;assert.equal(photos.fail('a'),60000);photos.fail('b');photos.fail('c');assert.equal(photos.retryAt('a'),0);assert.equal(photos.size(),2);now=90000;assert.equal(photos.retryAt('c'),0);photos.fail('c');photos.succeed('c');assert.equal(photos.retryAt('c'),0);
});
test('API misses revalidate HTTP even after JS eviction, so browser max-age cannot renew an old response TTL',async()=>{
 let now=0;const requests=[];const cache=createClientJSONCache({maxEntries:1,now:()=>now,fetcher:async(next,options)=>{
  requests.push({url:next,cache:options.cache});
  return reply({collection:{type:'FeatureCollection',features:[]},geography:{state:'live'},verifiedAt:now});
 }});
 const sp='/api/map?uf=sp&electionId=2026&turn=1&office=1&cycle=ele2026';
 const rj=sp.replace('uf=sp','uf=rj');
 assert.equal((await cache.read(sp)).verifiedAt,0);now=100000;await cache.read(rj);assert.equal(cache.peek(sp),null);
 now=200000;assert.equal((await cache.read(sp)).verifiedAt,200000);assert.equal(cache.deadline(sp),500000);
 assert.ok(requests.every(request=>request.cache==='no-cache'));
 await cache.read(sp);assert.equal(requests.length,3);
 now=500000;assert.equal((await cache.read(sp)).verifiedAt,500000);assert.equal(requests.length,4);assert.equal(requests[3].cache,'no-cache');
});
test('static assets keep normal browser caching while explicit revalidation uses no-cache',async()=>{
 const policies=[];const cache=createClientJSONCache({fetcher:async(_next,options)=>{policies.push(options.cache);return reply({type:'FeatureCollection',features:[]});}});
 await cache.read('/brasil-uf.geojson');await cache.read('/brasil-uf.geojson');await cache.read('/brasil-uf.geojson',undefined,{revalidate:true});
 assert.deepEqual(policies,['default','no-cache']);
});
