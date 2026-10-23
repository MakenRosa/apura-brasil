import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,stat,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {HttpResourceCache} from '../server/http-cache.mjs';
import {createServer} from '../server/index.mjs';
import {TseClient} from '../server/client.mjs';

async function temporary(){return mkdtemp(join(tmpdir(),'apura-http-cache-'));}
async function cleanup(directory){assert.ok(resolve(directory).startsWith(join(tmpdir(),'apura-http-cache-')));await rm(directory,{recursive:true,force:true});}
async function start(options={}){const client=new TseClient({dataDir:null,minInterval:0,fetchImpl:async()=>{throw new Error('Unexpected external request');}}),server=createServer({client,dataDir:null,...options});await new Promise(r=>server.listen(0,'127.0.0.1',r));return {server,base:`http://127.0.0.1:${server.address().port}`};}
async function close(server){await new Promise(r=>server.close(r));await server.apura.client.flush?.();}

test('static cache coalesces reads, promotes LRU hits and invalidates changed files',async()=>{
 const directory=await temporary();try{
  const cache=new HttpResourceCache({maxEntries:2,maxBytes:16,maxFileBytes:16});
  const paths=['one','two','three'].map(name=>join(directory,name));for(const path of paths)await writeFile(path,'body');
  const info=await stat(paths[0]),group=await Promise.all(Array.from({length:12},()=>cache.file(paths[0],info)));
  assert.ok(group.every(value=>value===group[0]));assert.equal(cache.metrics().fileReads,1);
  await cache.file(paths[1],await stat(paths[1]));await cache.file(paths[0],await stat(paths[0]));await cache.file(paths[2],await stat(paths[2]));
  assert.equal(cache.files.has(paths[1]),false);assert.equal(cache.files.has(paths[0]),true);assert.equal(cache.metrics().fileBytes,8);
  const old=group[0].etag;await writeFile(paths[0],'changed');const changed=await cache.file(paths[0],await stat(paths[0]));assert.notEqual(changed.etag,old);assert.equal(changed.body.toString(),'changed');
 }finally{await cleanup(directory);}
});

test('HTTP static assets use validators, immutable fingerprints, cached compression and fresh HTML',async()=>{
 const directory=await temporary();await mkdir(join(directory,'assets'));const text='const cacheProof = "'+('abcdefgh'.repeat(800))+'";';
 await writeFile(join(directory,'assets','index-abcdefgh.js'),text);await writeFile(join(directory,'index.html'),'<html>first</html>');const {server,base}=await start({distDir:directory});
 try{
  const first=await fetch(base+'/assets/index-abcdefgh.js',{headers:{'accept-encoding':'gzip'}});assert.equal(await first.text(),text);assert.match(first.headers.get('cache-control'),/immutable/);assert.equal(first.headers.get('content-encoding'),'gzip');assert.ok(Number(first.headers.get('content-length'))<text.length/4);const tag=first.headers.get('etag');
  const second=await fetch(base+'/assets/index-abcdefgh.js',{headers:{'accept-encoding':'gzip','if-none-match':'W/'+tag}});assert.equal(second.status,304);assert.equal((await second.arrayBuffer()).byteLength,0);
  const identity=await fetch(base+'/assets/index-abcdefgh.js',{headers:{'accept-encoding':'gzip;q=0, identity;q=1','if-none-match':tag}});assert.equal(identity.status,200);assert.equal(identity.headers.get('content-encoding'),null);assert.notEqual(identity.headers.get('etag'),tag);assert.equal(await identity.text(),text);
  const head=await fetch(base+'/assets/index-abcdefgh.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal((await head.arrayBuffer()).byteLength,0);
  const firstHTML=await fetch(base+'/');assert.equal(firstHTML.headers.get('cache-control'),'no-cache');const htmlTag=firstHTML.headers.get('etag');await firstHTML.text();await writeFile(join(directory,'index.html'),'<html>second build</html>');
  const updated=await fetch(base+'/',{headers:{'if-none-match':htmlTag}});assert.equal(updated.status,200);assert.equal(await updated.text(),'<html>second build</html>');
  const metrics=server.apura.httpCache.metrics();assert.equal(metrics.compressions,1);assert.equal(metrics.notModified,1);assert.ok(metrics.fileHits>=3);
 }finally{await close(server);await cleanup(directory);}
});

test('HTTP cache cannot bypass realpath containment after a warm directory becomes a junction',async()=>{
 const directory=await temporary(),dist=join(directory,'dist'),alias=join(dist,'alias'),outside=join(directory,'outside');await mkdir(alias,{recursive:true});await mkdir(outside);await writeFile(join(alias,'data.txt'),'inside');await writeFile(join(outside,'data.txt'),'outside');const {server,base}=await start({distDir:dist});
 try{
  const first=await fetch(base+'/alias/data.txt');assert.equal(await first.text(),'inside');const tag=first.headers.get('etag');assert.ok(resolve(alias).startsWith(resolve(directory)));
  await rm(alias,{recursive:true,force:true});await symlink(outside,alias,process.platform==='win32'?'junction':'dir');
  const refused=await fetch(base+'/alias/data.txt',{headers:{'if-none-match':tag}});assert.equal(refused.status,403);assert.equal(refused.headers.get('cache-control'),'no-store');assert.ok(!(await refused.text()).includes('outside'));
 }finally{await close(server);await cleanup(directory);}
});

test('API validators respect current data and query validation; health and failures remain uncached',async()=>{
 let generation=1,calls=0;const service={bootstrap:async()=>({status:{state:'cached'},value:1}),results:async query=>{calls++;return {query,data:{generation},source:{state:'cached',checkedAt:'2026-10-05T12:00:00Z'},history:[]};},municipalities:async()=>({municipalities:[],source:{state:'waiting'}})};
 const mapService={preview:async uf=>({uf,collection:null,geography:{state:'unavailable'},coverage:{total:0,linked:0,unmatched:0}})};const {server,base}=await start({service,mapService});
 try{
  const first=await fetch(base+'/api/results');assert.equal(first.headers.get('cache-control'),'private, no-cache');const tag=first.headers.get('etag');await first.json();
  const repeated=await fetch(base+'/api/results',{headers:{'if-none-match':tag}});assert.equal(repeated.status,304);assert.equal(calls,2);
  generation=2;const updated=await fetch(base+'/api/results',{headers:{'if-none-match':tag}});assert.equal(updated.status,200);assert.equal((await updated.json()).data.generation,2);
  const invalid=await fetch(base+'/api/results?turn=abc',{headers:{'if-none-match':'*'}});assert.equal(invalid.status,400);assert.equal(calls,3);assert.equal(invalid.headers.get('cache-control'),'no-store');
  const preview=await fetch(base+'/api/map-preview?uf=sc');assert.equal(preview.headers.get('cache-control'),'private, no-cache');await preview.json();
  const unavailableList=await fetch(base+'/api/municipalities?uf=sc');assert.equal(unavailableList.headers.get('cache-control'),'private, no-cache');await unavailableList.json();
  const health=await fetch(base+'/api/health');assert.equal(health.headers.get('cache-control'),'no-store');assert.ok((await health.json()).cache.http.notModified>=1);
 }finally{await close(server);}
});
