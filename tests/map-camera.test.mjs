import test from 'node:test';
import assert from 'node:assert/strict';
import { boundFrame, fitFrame, zoomFrame, interpolateFrame, createMapCamera, MAP_HOME } from '../src/lib/map-camera.ts';

test('camera preserves cursor anchor, aspect and supported zoom limits',()=>{
 const next=zoomFrame(MAP_HOME,.5,[.3,.7]);
 assert.equal(next.x+next.w*.3,300);
 assert.ok(Math.abs(next.y+next.h*.7-490)<1e-9);
 assert.ok(Math.abs(next.h/next.w-.7)<1e-9);
 assert.equal(boundFrame({x:-999,y:999,w:1,h:1}).w,1000/18);
 assert.deepEqual(zoomFrame(MAP_HOME,2),MAP_HOME);
 const fitted=fitFrame({x:350,y:250,w:100,h:90});
 assert.ok(fitted.x<=350&&fitted.x+fitted.w>=450);
 assert.ok(fitted.y<=250&&fitted.y+fitted.h>=340);
});
test('camera animates continuously and lands exactly on the target',()=>{
 const to=fitFrame({x:450,y:320,w:30,h:40});
 const a=interpolateFrame(MAP_HOME,to,.49),b=interpolateFrame(MAP_HOME,to,.5),c=interpolateFrame(MAP_HOME,to,.51);
 assert.ok(a.w>b.w&&b.w>c.w);
 assert.ok(Math.abs(b.h/b.w-.7)<1e-9);
 assert.deepEqual(interpolateFrame(MAP_HOME,to,1),to);
});
test('interrupted navigation cannot finish a previous scope change; new movement starts at visible frame',()=>{
 let now=0,id=0;const queue=new Map(),frames=[];let obsolete=0,completed=0;
 const camera=createMapCamera({now:()=>now,request:fn=>{queue.set(++id,fn);return id;},cancel:key=>queue.delete(key)},frame=>frames.push(frame));
 const advance=time=>{now=time;const callbacks=[...queue.values()];queue.clear();callbacks.forEach(fn=>fn(time));};
 camera.move(zoomFrame(MAP_HOME,.5),400,()=>obsolete++);
 advance(200);const visible=camera.current();
 camera.move(MAP_HOME,200,()=>completed++);
 advance(200);assert.deepEqual(camera.current(),visible);
 advance(400);assert.deepEqual(camera.current(),MAP_HOME);assert.equal(obsolete,0);assert.equal(completed,1);
 camera.move(zoomFrame(MAP_HOME,.5),400,()=>obsolete++);camera.cancel();advance(800);assert.equal(obsolete,0);
});
test('zero duration uses the target immediately without scheduling animation',()=>{
 let scheduled=0,complete=0,last;
 const camera=createMapCamera({now:()=>0,request:()=>++scheduled,cancel:()=>{}},frame=>last=frame);
 const target=fitFrame({x:200,y:250,w:40,h:20});
 camera.move(target,0,()=>complete++);
 assert.deepEqual(last,target);assert.equal(scheduled,0);assert.equal(complete,1);
});
test('enabling reduced motion finishes deferred scope navigation exactly once',()=>{
 let done=0;const queue=new Map();let id=0;
 const camera=createMapCamera({now:()=>0,request:fn=>{queue.set(++id,fn);return id;},cancel:key=>queue.delete(key)},()=>{});
 const target=zoomFrame(MAP_HOME,.4);
 camera.move(target,500,()=>done++);camera.finish();camera.finish();
 assert.deepEqual(camera.current(),target);assert.equal(done,1);assert.equal(queue.size,0);
});
