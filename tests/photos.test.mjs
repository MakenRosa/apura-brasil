import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG_URL,BASE} from '../server/constants.mjs';
import {TseClient} from '../server/client.mjs';
import {ElectionService} from '../server/service.mjs';
import {normalizeConfig,normalizeResult} from '../server/normalize.mjs';
import {PhotoClient,CandidatePhotoService} from '../server/photos.mjs';
import {assertPhotoUrl,photoUpstream} from '../server/photo-identity.mjs';
import {createServer} from '../server/index.mjs';
const [ea11,ea20,photo]=await Promise.all([readFile(new URL('fixtures/ea11-official.json',import.meta.url),'utf8').then(JSON.parse),readFile(new URL('fixtures/ea20-official.json',import.meta.url),'utf8').then(JSON.parse),readFile(new URL('fixtures/tse-photo-280002542548.jpeg',import.meta.url))]);
const query={cycle:'ele2026',turn:1,office:'1',uf:'br',electionId:'6257'},sequence='280002542548',url=photoUpstream(query,sequence,ea11);
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const image=(status=200,headers={})=>new Response(status===304?null:photo,{status,headers:{'content-type':'image/jpeg',...headers}});
const clientFor=(fetchImpl,options={})=>new TseClient({fetchImpl,minInterval:0,dataDir:null,...options});
const photosFor=(client,options={})=>new PhotoClient(client,{minInterval:0,dataDir:null,...options});

test('fotos usam sqcand oficial; Presidente mantém br em UF/município e demais cargos usam UF',()=>{
 assert.equal(url,`${BASE}/oficial/ele2026/6257/fotos/br/${sequence}.jpeg`);
 assert.equal(photoUpstream({...query,uf:'sp',municipality:'71072'},sequence,ea11),url);
 assert.equal(photoUpstream({...query,office:'6',uf:'sp',electionId:'6259'},sequence,ea11),`${BASE}/oficial/ele2026/6259/fotos/sp/${sequence}.jpeg`);
 const election=normalizeConfig(ea11).find(e=>e.id==='6257'),data=normalizeResult(ea20,query,election),candidate=data.candidates.find(c=>c.sequence===sequence);
 assert.ok(candidate.photoUrl.startsWith('/api/photo?'));assert.ok(candidate.photoUrl.includes(`candidate=${sequence}`));assert.equal(candidate.photoSource.provider,'TSE');assert.equal(candidate.photoSource.url,url);
 const simulated={...ea20,f:'s'};assert.ok(normalizeResult(simulated,query,election).candidates.every(c=>!c.photoUrl&&!c.photoSource));
});
test('origem, caminho, formato e identidade de foto bloqueiam SSRF e nomes arbitrários',()=>{
 for(const value of ['https://evil.test/a.jpeg',`${BASE}/oficial/ele2026/6257/fotos/br/${sequence}.jpeg?url=x`,`${BASE}/oficial/ele2026/6257/fotos/br/LULA.jpeg`,`${BASE}/oficial/ele2026/6257/fotos/xx/${sequence}.jpeg`,`http://resultados.tse.jus.br/oficial/ele2026/6257/fotos/br/${sequence}.jpeg`])assert.throws(()=>assertPhotoUrl(value));
 assert.throws(()=>photoUpstream(query,'LULA',ea11));assert.throws(()=>photoUpstream(query,sequence,{arq:[{tp:'ft',dir:'https://evil.test'}]}));
});
test('JPEG oficial completo: cache, coalescência e validação condicional preservam bytes',async()=>{
 let now=100000,calls=0,headers;const client=clientFor(async(url,options)=>{calls++;headers=options.headers;return calls===1?image(200,{etag:'"foto"','last-modified':'Sun, 04 Oct 2026 12:00:00 GMT'}):image(304);},{now:()=>now});const photos=photosFor(client,{now:()=>now,ttl:100});
 const [first,second]=await Promise.all([photos.get(url),photos.get(url)]);assert.equal(calls,1);assert.equal(first,second);assert.equal(first.state,'live');assert.deepEqual(first.body,photo);
 assert.equal((await photos.get(url)).state,'cached');assert.equal(calls,1);now+=101;
 const checked=await photos.get(url);assert.equal(checked.state,'cached');assert.equal(checked.httpStatus,304);assert.deepEqual(checked.body,photo);assert.equal(headers['If-None-Match'],'"foto"');assert.ok(headers['If-Modified-Since']);
});
test('cache de foto em disco é restaurado sem download e atualizado como stale em falha',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-photo-'));let now=100000,calls=0;
 try{
  const photos=photosFor(clientFor(async()=>image()),{dataDir:directory,now:()=>now,ttl:100});await photos.get(url);
  const restored=photosFor(clientFor(async()=>{calls++;throw new Error('Offline');}),{dataDir:directory,now:()=>now,ttl:100});assert.deepEqual((await restored.get(url)).body,photo);assert.equal(calls,0);
  now+=101;const stale=await restored.get(url);assert.equal(stale.state,'stale');assert.deepEqual(stale.body,photo);assert.equal(calls,1);await restored.get(url);assert.equal(calls,1);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('404 por foto tem backoff; três fotos ausentes pausam apenas novas fotos',async()=>{
 let now=100000,calls=0;const client=clientFor(async()=>{calls++;return new Response('',{status:404});},{now:()=>now});const photos=photosFor(client,{now:()=>now});
 const missing=await photos.get(url);assert.equal(missing.body,null);assert.equal(missing.httpStatus,404);assert.equal(photos.entries.get(url).retryAt,now+60000);await photos.get(url);assert.equal(calls,1);
 for(const id of ['280002551544','280002551932'])await photos.get(photoUpstream(query,id,ea11));assert.equal(calls,3);assert.equal(photos.photoPauseUntil,now+600000);assert.equal(client.cooldownUntil,0);
 await photos.get(photoUpstream(query,'280002552484',ea11));assert.equal(calls,3);
});
test('403/429 de imagem aplicam cooldown global TSE e preservam última foto',async()=>{
 for(const status of [403,429]){let now=100000,calls=0;const client=clientFor(async()=>{calls++;return calls===1?image():new Response('',{status});},{now:()=>now});const photos=photosFor(client,{now:()=>now,ttl:100});
  await photos.get(url);now+=101;const denied=await photos.get(url);assert.equal(denied.state,'stale');assert.deepEqual(denied.body,photo);assert.equal(client.cooldownUntil,now+600000);
  const votes=await client.get(CONFIG_URL);assert.equal(votes.source.state,'unavailable');assert.equal(calls,2);
 }
});
test('resposta HTML, JPEG inválido, tamanho excessivo e timeout não geram imagem inventada',async()=>{
 for(const fetchImpl of [async()=>new Response('<html>',{headers:{'content-type':'text/html'}}),async()=>new Response('notjpeg',{headers:{'content-type':'image/jpeg'}}),async()=>image(200,{'content-length':'99999999'})]){const result=await photosFor(clientFor(fetchImpl)).get(url);assert.equal(result.body,null);assert.equal(result.state,'unavailable');}
 const timeout=photosFor(clientFor(async(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))),{timeout:5});const keepAlive=setTimeout(()=>{},100);
 try{assert.match((await timeout.get(url)).message,/Tempo limite/);}finally{clearTimeout(keepAlive);}
});
test('um download de foto por vez deixa consulta de votos passar e fila TSE prioriza dados',async()=>{
 let release,active=0,max=0,calls=0,block=true;const client=clientFor(async requested=>{
  if(!requested.endsWith('.jpeg'))return json(ea11);calls++;active++;max=Math.max(max,active);if(block)await new Promise(r=>release=r);active--;return image();
 });const photos=photosFor(client);const first=photos.get(url);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
 const pending=photos.get(photoUpstream(query,'280002551544',ea11));assert.equal((await client.get(CONFIG_URL)).source.state,'live');assert.equal(calls,1);block=false;release();await Promise.all([first,pending]);assert.equal(max,1);
 const order=[];client.active=3;const photoJob=client.enqueue(()=>order.push('photo'),{priority:'photo'}),dataJob=client.enqueue(()=>order.push('data'));client.active=0;client.pump();await Promise.all([photoJob,dataJob]);assert.deepEqual(order,['data','photo']);
});
test('fila de demanda tem limite e não transforma imagens solicitadas em download massivo',async()=>{
 let release,block=true,calls=0;const client=clientFor(async()=>{calls++;if(block)await new Promise(r=>release=r);return image();});const photos=photosFor(client,{maxQueued:1});
 const first=photos.get(url);await new Promise(r=>setImmediate(r));const second=photos.get(photoUpstream(query,'280002551544',ea11));await new Promise(r=>setImmediate(r));
 const overflow=await photos.get(photoUpstream(query,'280002551932',ea11));assert.equal(overflow.body,null);assert.match(overflow.message,/Fila local/);assert.equal(calls,1);
 block=false;release();await Promise.all([first,second]);assert.equal(calls,2);
});
test('HTTP foto autoriza sqcand do EA20 já coletado e não busca resultado nem foto de nome/ID desconhecido',async()=>{
 let imageCalls=0,dataCalls=0;const client=clientFor(async requested=>{if(requested.endsWith('.jpeg')){imageCalls++;return image();}dataCalls++;return json(requested===CONFIG_URL?ea11:ea20);});const service=new ElectionService(client),photoClient=photosFor(client),server=createServer({client,service,photoClient});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const result=await(await fetch(base+'/api/results')).json();const candidate=result.data.candidates.find(c=>c.sequence===sequence);assert.equal(imageCalls,0);assert.equal(dataCalls,2);
  const received=await fetch(base+candidate.photoUrl);assert.equal(received.status,200);assert.equal(received.headers.get('content-type'),'image/jpeg');assert.equal(received.headers.get('x-apura-source-url'),url);assert.deepEqual(Buffer.from(await received.arrayBuffer()),photo);
  await fetch(base+candidate.photoUrl);assert.equal(imageCalls,1);assert.equal(dataCalls,2);
  assert.equal((await fetch(base+candidate.photoUrl.replace(sequence,'999999999999'))).status,404);assert.equal(imageCalls,1);assert.equal(dataCalls,2);
  assert.equal((await fetch(base+'/api/photo?candidate=LULA')).status,400);assert.equal((await fetch(base+'/api/photo?candidate='+sequence+'&url=https://evil.test')).status,400);
  client.cache.delete(`${BASE}/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json`);assert.equal((await fetch(base+candidate.photoUrl)).status,503);assert.equal(imageCalls,1);assert.equal(dataCalls,2);
 }finally{await new Promise(r=>server.close(r));}
});
