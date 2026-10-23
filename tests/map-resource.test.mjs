import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapResource,createMapEntry} from '../src/lib/map-resource.ts';

test('zoom and cartography may complete in either order without an empty map handoff',()=>{
 for(const order of [['zoomReady','mapReady'],['mapReady','zoomReady']]){
  let count=0;const entry=createMapEntry().begin(()=>count++);
  entry[order[0]]();assert.equal(count,0);entry[order[1]]();assert.equal(count,1);
  entry.mapReady();entry.zoomReady();assert.equal(count,1);
 }
});
test('changing scope or interacting during a slow map request prevents obsolete navigation',()=>{
 const controller=createMapEntry();const selected=[];
 const old=controller.begin(()=>selected.push('sp'));old.zoomReady();
 const next=controller.begin(()=>selected.push('rj'));old.mapReady();assert.deepEqual(selected,[]);
 next.mapReady();controller.cancel();next.zoomReady();assert.deepEqual(selected,[]);
});
test('prefetch and the destination effect share a single request and usable cached collection',async()=>{
 let calls=0,resolve;const data={collection:{features:[{id:'city'}]}};
 const cache=createMapResource(()=>{calls++;return new Promise(done=>resolve=done);});
 const first=cache.load('preview:sp','/api/map-preview?uf=sp');
 const effect=cache.load('preview:sp','/api/map-preview?uf=sp');
 assert.equal(calls,1);assert.equal(first,effect);resolve(data);await first;
 assert.equal(cache.peek('preview:sp'),data);assert.equal(await cache.load('preview:sp','same'),data);assert.equal(calls,1);
});
test('preview, election, office and turn resources are isolated; expiration and retry are bounded',async()=>{
 let calls=0,now=0;const cache=createMapResource(async url=>({url,id:++calls}),2,100,()=>now);
 await cache.load('preview:sp','preview');await cache.load('turn1:office1:sp','first');
 assert.equal(cache.peek('turn2:office1:sp'),null);
 await cache.load('turn2:office1:sp','second');assert.equal(cache.peek('preview:sp'),null);
 now=101;assert.equal(cache.peek('turn2:office1:sp'),null);
 await cache.load('turn2:office1:sp','second');cache.invalidate('turn2:office1:sp');assert.equal(cache.peek('turn2:office1:sp'),null);
 assert.equal(calls,4);
});
test('failed or cancelled downloads do not poison a retry or a newer resource',async()=>{
 let reject,signal;const cache=createMapResource((url,nextSignal)=>{signal=nextSignal;return new Promise((_,fail)=>reject=fail);});
 const request=cache.load('sp','map');cache.clear();assert.equal(signal.aborted,true);reject(new Error('cancelled'));
 await assert.rejects(request);assert.equal(cache.peek('sp'),null);
 const failing=createMapResource(async()=>{throw new Error('offline');});
 await assert.rejects(failing.load('sp','map'));await assert.rejects(failing.load('sp','map'));
});
