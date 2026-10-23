import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapProjection, projectMapPoint, rebaseMapFrame } from '../src/lib/map-projection.ts';
import { createMapCamera, MAP_HOME } from '../src/lib/map-camera.ts';

test('switching projections preserves geographic screen positions at both state and city zoom',()=>{
 const national=createMapProjection([[-74,-34],[-35,6]]);
 const local=createMapProjection([[-53,-29],[-48,-26]]);
 for(const frame of [MAP_HOME,{x:300,y:240,w:180,h:126}]){
  const rebased=rebaseMapFrame(frame,local,national);
  for(const point of [[-53,-29],[-48,-26],[-50.5,-27.2]]){
   const before=projectMapPoint(point,local),after=projectMapPoint(point,national);
   assert.ok(Math.abs((before[0]-frame.x)/frame.w-(after[0]-rebased.x)/rebased.w)<1e-10);
   assert.ok(Math.abs((before[1]-frame.y)/frame.h-(after[1]-rebased.y)/rebased.h)<1e-10);
  }
  const roundTrip=rebaseMapFrame(rebased,national,local);
  for(const key of ['x','y','w','h'])assert.ok(Math.abs(roundTrip[key]-frame[key])<1e-9);
 }
});

test('empty or degenerate cartography cannot create a projection',()=>{
 assert.equal(createMapProjection([]),null);
 assert.equal(createMapProjection([[NaN,NaN]]),null);
 assert.equal(createMapProjection([[-48,-27],[-48,-26]]),null);
 assert.deepEqual(createMapProjection([[NaN,NaN],[-53,-29],[-48,-26]]),createMapProjection([[-53,-29],[-48,-26]]));
});

test('zooming out of a small UF starts at its visible extent without the normal manual zoom clamp',()=>{
 let now=0,id=0,done=0;const queue=new Map(),frames=[];
 const camera=createMapCamera({now:()=>now,request:callback=>{queue.set(++id,callback);return id;},cancel:key=>queue.delete(key)},frame=>frames.push(frame));
 const initial={x:525,y:360,w:4,h:2.8};camera.rebase(initial);camera.move(MAP_HOME,720,()=>done++);
 for(const elapsed of [0,120,360,540,720]){
  now=elapsed;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(callback=>callback(now));
 }
 assert.deepEqual(frames[1],initial);
 assert.ok(frames[2].w>4&&frames[2].w<1000/18);
 assert.ok(frames[3].w>frames[2].w);
 assert.deepEqual(camera.current(),MAP_HOME);assert.equal(done,1);assert.equal(queue.size,0);
});

test('projection return respects reduced motion and cancelling a changed electoral scope',()=>{
 let id=0,done=0;const queue=new Map();
 const camera=createMapCamera({now:()=>0,request:callback=>{queue.set(++id,callback);return id;},cancel:key=>queue.delete(key)},()=>{});
 camera.rebase({x:525,y:360,w:4,h:2.8});camera.move(MAP_HOME,720,()=>done++);camera.cancel();
 assert.equal(done,0);assert.equal(queue.size,0);
 camera.move(MAP_HOME,0,()=>done++);assert.deepEqual(camera.current(),MAP_HOME);assert.equal(done,1);
});
