import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {PhotoClient} from '../server/photos.mjs';
import {TseClient} from '../server/client.mjs';
import {photoUpstream} from '../server/photo-identity.mjs';
import {ElectionService} from '../server/service.mjs';
import {createServer} from '../server/index.mjs';
import {CONFIG_URL,BASE} from '../server/constants.mjs';
const [config,photo]=await Promise.all([readFile(new URL('fixtures/ea11-official.json',import.meta.url),'utf8').then(JSON.parse),readFile(new URL('fixtures/tse-photo-280002542548.jpeg',import.meta.url))]);
const query={cycle:'ele2026',turn:1,office:'1',uf:'br',electionId:'6257'},url=sequence=>photoUpstream(query,sequence,config);
const picture=()=>new Response(photo,{headers:{'content-type':'image/jpeg',etag:'"official-photo"','last-modified':'Sun, 04 Oct 2026 12:00:00 GMT'}});
const client=fetchImpl=>new TseClient({dataDir:null,minInterval:0,fetchImpl});

test('a failed photo revalidation never renews its positive TTL, and retry fetches again',async()=>{
 let now=100000,calls=0;const photos=new PhotoClient(client(async()=>++calls===2?new Response('',{status:503}):picture()),{dataDir:null,minInterval:0,ttl:100,now:()=>now});const requested=url('280002542548');
 const first=await photos.get(requested);const originalTag=first.etag;now+=101;const failed=await photos.get(requested);assert.equal(failed.state,'stale');assert.deepEqual(failed.body,photo);assert.equal(photos.entries.get(requested).validatedAt,100000);
 now=photos.entries.get(requested).retryAt+1;const retried=await photos.get(requested);assert.equal(calls,3);assert.equal(retried.state,'live');assert.equal(retried.etag,originalTag);assert.equal((await photos.get(requested)).state,'cached');assert.equal(calls,3);
});

test('photo memory and metadata use bounded LRU and preserve recently used images',async()=>{
 const photos=new PhotoClient(client(async()=>picture()),{dataDir:null,minInterval:0,maxEntries:2,maxMemoryEntries:2,maxMemoryBytes:photo.length*2});const urls=['280002542548','280002551544','280002551932'].map(url);
 await photos.get(urls[0]);await photos.get(urls[1]);await photos.get(urls[0]);await photos.get(urls[2]);
 assert.ok(photos.bodies.has(urls[0]));assert.equal(photos.bodies.has(urls[1]),false);assert.equal(photos.entries.has(urls[1]),false);assert.equal(photos.metrics().memoryBytes,photo.length*2);assert.equal(photos.metrics().entries,2);
});

test('concurrent restored portraits share one disk read; a missing JPEG drops validators',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-photo-cache-'));let now=100000,calls=0,lastHeaders;
 try{
  const original=new PhotoClient(client(async()=>picture()),{dataDir:directory,minInterval:0,ttl:100,now:()=>now}),requested=url('280002542548');await original.get(requested);await original.flush();
  const restored=new PhotoClient(client(async(_,{headers})=>{calls++;lastHeaders=headers;return picture();}),{dataDir:directory,minInterval:0,ttl:100,now:()=>now});
  const group=await Promise.all(Array.from({length:12},()=>restored.get(requested)));assert.ok(group.every(value=>value.state==='cached'));assert.equal(calls,0);assert.equal(restored.metrics().diskReads,1);assert.ok(restored.metrics().coalescedReads>=1);
  restored.forgetBody(requested);await unlink(restored.file(requested));now+=101;const repaired=await restored.get(requested);assert.equal(calls,1);assert.equal(lastHeaders['If-None-Match'],undefined);assert.equal(lastHeaders['If-Modified-Since'],undefined);assert.deepEqual(repaired.body,photo);assert.equal(repaired.state,'live');await restored.flush();
 }finally{assert.ok(resolve(directory).startsWith(join(tmpdir(),'apura-photo-cache-')));await rm(directory,{recursive:true,force:true});}
});

test('photo HTTP 304 reuses bytes but cannot bypass candidate or result authorization',async()=>{
 const raw=JSON.parse(await readFile(new URL('fixtures/ea20-official.json',import.meta.url),'utf8'));let photoCalls=0;
 const tse=client(async requested=>requested.endsWith('.jpeg')?(photoCalls++,picture()):new Response(JSON.stringify(requested===CONFIG_URL?config:raw),{headers:{'content-type':'application/json'}}));
 const photos=new PhotoClient(tse,{dataDir:null,minInterval:0}),service=new ElectionService(tse),server=createServer({client:tse,service,photoClient:photos,dataDir:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const result=await (await fetch(base+'/api/results')).json(),localURL=result.data.candidates.find(candidate=>candidate.sequence==='280002542548').photoUrl;
  const first=await fetch(base+localURL),tag=first.headers.get('etag');assert.deepEqual(Buffer.from(await first.arrayBuffer()),photo);assert.ok(tag);assert.match(first.headers.get('cache-control'),/max-age=3600/);
  const repeated=await fetch(base+localURL,{headers:{'if-none-match':tag}});assert.equal(repeated.status,304);assert.equal((await repeated.arrayBuffer()).byteLength,0);assert.equal(photoCalls,1);
  const unknown=await fetch(base+localURL.replace('280002542548','999999999999'),{headers:{'if-none-match':tag}});assert.equal(unknown.status,404);assert.equal(unknown.headers.get('cache-control'),'no-store');assert.equal(photoCalls,1);
  tse.cache.delete(`${BASE}/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json`);
  const unauthorized=await fetch(base+localURL,{headers:{'if-none-match':tag}});assert.equal(unauthorized.status,503);assert.equal(unauthorized.headers.get('cache-control'),'no-store');assert.equal(photoCalls,1);
 }finally{await new Promise(r=>server.close(r));await tse.flush?.();await photos.flush();}
});
