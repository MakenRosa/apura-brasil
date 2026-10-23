import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm,readdir,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TseClient} from '../server/client.mjs';
import {ElectionService,buildUrl} from '../server/service.mjs';
import {normalizeConfig,normalizeResult} from '../server/normalize.mjs';
import {GeographyClient,MunicipalMapService} from '../server/geography.mjs';
import {BASE,CONFIG_URL,STATES} from '../server/constants.mjs';

const fixture=async name=>JSON.parse(await readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8'));
const [ea11,ea12,ea20,geometry,localities]=await Promise.all(['ea11-official.json','ea12-official.json','ea20-official.json','ibge-sp-malha.json','ibge-sp-localidades.json'].map(fixture));
const clone=value=>structuredClone(value),reply=(raw,status=200,headers={})=>new Response(status===304?null:JSON.stringify(raw),{status,headers:{'content-type':'application/json',...headers}});
const query={cycle:'ele2026',turn:1,office:'1',uf:'br',electionId:'6257'},election=normalizeConfig(ea11).find(e=>e.id==='6257'),resultUrl=buildUrl('u',query,election,ea11);
const url=name=>`${BASE}/oficial/ele2026/6257/dados/br/${name}.json`;
const tse=(fetchImpl,options={})=>new TseClient({fetchImpl,minInterval:0,dataDir:null,...options});
async function directory(t){const path=await mkdtemp(join(tmpdir(),'apura-cache-'));t.after(()=>rm(path,{recursive:true,force:true}));return path;}
function ufResult(uf){const raw=clone(ea20);raw.tpabr='uf';raw.cdabr=uf;return raw;}

test('cache hit/negative/cooldown mantêm checkedAt real, sem consulta fictícia',async()=>{
 let now=100000,calls=0;const client=tse(async()=>{calls++;return reply(ea20);},{now:()=>now});const initial=await client.get(resultUrl);now+=5000;const cached=await client.get(resultUrl);assert.equal(cached.source.checkedAt,initial.source.checkedAt);assert.equal(calls,1);
 const negative=tse(async()=>reply({},404),{now:()=>now});const missing=await negative.get(url('missing'));now+=1000;assert.equal((await negative.get(url('missing'))).source.checkedAt,missing.source.checkedAt);
 client.cooldownUntil=now+600000;assert.equal((await client.get(url('not-observed'))).source.checkedAt,null);assert.equal(calls,1);
});

test('validação memoizada permanece separada por schema/identidade e payload novo',async()=>{
 let validations=0,now=100000,raw=clone(ea20);const client=tse(async()=>reply(raw),{now:()=>now}),validate=value=>{validations++;return value.ele==='6257';};
 await client.get(resultUrl,{validate,validationKey:'president:br'});for(let i=0;i<10;i++)await client.get(resultUrl,{validate,validationKey:'president:br'});assert.equal(validations,1);
 await client.get(resultUrl,{validate,validationKey:'second-schema'});assert.equal(validations,2);
 now+=16000;raw.idg='changed';await client.get(resultUrl,{validate,validationKey:'president:br'});assert.equal(validations,3);
});

test('cache inválido limpa ETag/LastModified e não fica preso em 304 sem corpo',async t=>{
 const path=await directory(t);await writeFile(join(path,'tse-cache.json'),JSON.stringify({version:1,entries:[[resultUrl,{raw:{f:'o',ele:'wrong'},etag:'"invalid"',lastModified:'yesterday',checkedAt:100000,history:[]}]],cooldownUntil:0}));
 let headers;const client=tse(async(_,options)=>{headers=options.headers;return reply(ea20);},{dataDir:path,now:()=>100001});const result=await client.get(resultUrl,{validate:raw=>raw.ele==='6257'});
 assert.equal(result.source.state,'live');assert.equal(headers['If-None-Match'],undefined);assert.equal(headers['If-Modified-Since'],undefined);assert.equal(result.raw.ele,'6257');
});

test('manifesto com raw primitivo é recuperado sem envenenar WeakMaps ou validators',async t=>{
 const path=await directory(t);await writeFile(join(path,'tse-cache.json'),JSON.stringify({version:1,entries:[[resultUrl,{raw:'bad',etag:'"bad"',history:[]}]]}));
 let headers;const client=tse(async(_,options)=>{headers=options.headers;return reply(ea20);},{dataDir:path});await client.ready;assert.equal(client.cache.get(resultUrl).raw,null);const result=await client.get(resultUrl);assert.equal(result.source.state,'live');assert.equal(headers['If-None-Match'],undefined);assert.equal(client.health().cacheBytes,Buffer.byteLength(JSON.stringify(ea20)));
});

test('200 idêntico/304 preservam objeto e histórico; correção com mesmo IDG invalida memo',async()=>{
 let now=100000,raw=clone(ea20),status=200;const client=tse(async()=>reply(raw,status),{now:()=>now});const first=await client.get(resultUrl);await client.history(resultUrl,normalizeResult(first.raw,query,election),first.source);
 now+=16000;const same=await client.get(resultUrl);assert.equal(same.raw,first.raw);assert.equal(same.source.fetchedAt,first.source.fetchedAt);assert.notEqual(same.source.checkedAt,first.source.checkedAt);assert.equal(same.entry.history.length,1);
 now+=16000;status=304;assert.equal((await client.get(resultUrl)).raw,first.raw);
 now+=16000;status=200;raw.carg[0].agr[0].par[0].cand[0].vap='1';const correction=await client.get(resultUrl);assert.notEqual(correction.raw,first.raw);assert.equal(correction.raw.idg,first.raw.idg);assert.equal(correction.raw.carg[0].agr[0].par[0].cand[0].vap,'1');
});

test('requisição coalescida ainda valida a identidade exigida pelo segundo consumidor',async()=>{
 let calls=0;const client=tse(async()=>{calls++;await new Promise(r=>setTimeout(r,2));return reply(ea20);});
 const [good,bad]=await Promise.all([client.get(resultUrl,{validate:raw=>raw.ele==='6257'}),client.get(resultUrl,{validate:raw=>raw.ele==='9999'})]);assert.equal(calls,1);assert.equal(good.raw.ele,'6257');assert.equal(bad.raw,null);assert.equal(bad.source.state,'unavailable');
});

test('erro não prolonga TTL positivo de EA11/EA12: retry concluído revalida antes de cinco minutos/uma hora',async()=>{
 for(const ttl of [300000,3600000]){
  let now=100000,status=200,calls=0;const client=tse(async()=>{calls++;return reply(ea20,status);},{now:()=>now});await client.get(resultUrl,{ttl});now+=ttl;status=503;const failed=await client.get(resultUrl,{ttl});assert.equal(failed.source.state,'stale');now+=1000;assert.equal((await client.get(resultUrl,{ttl})).source.state,'stale');assert.equal(calls,2);
  now+=30000;status=304;assert.equal((await client.get(resultUrl,{ttl})).source.state,'cached');assert.equal(calls,3);
 }
});

test('LRU por leitura e limite de bytes preservam histórico/backoff de payload descartado após restart',async t=>{
 const path=await directory(t),a=url('a'),b=url('b'),c=url('c');let now=100000,status=200;
 const client=tse(async()=>reply(ea20,status),{dataDir:path,now:()=>now,maxEntries:2,maxCacheBytes:Buffer.byteLength(JSON.stringify(ea20))*2+1});
 await client.get(a);await client.history(a,normalizeResult(ea20,query,election),client.source(a,client.cache.get(a),'cached'));await client.get(b);await client.get(a);await client.get(c);assert.ok(client.cache.has(a));assert.ok(!client.cache.has(b));
 status=404;await client.get(url('negative'));await client.get(url('another-negative'));assert.ok(client.health().cacheBytes<=client.maxCacheBytes);await client.flush();
 const restored=tse(async()=>reply(ea20),{dataDir:path,now:()=>now,maxEntries:2,maxCacheBytes:client.maxCacheBytes});await restored.ready;assert.equal(restored.retainedEntries.get(a)?.history.length,1);const negative=await restored.get(url('negative'));assert.equal(negative.source.state,'waiting');assert.equal(restored.requests,0);
 const recovered=await restored.get(a);assert.equal(recovered.entry.history.length,1);assert.equal(recovered.raw.ele,'6257');
 const byBytes=tse(async()=>reply(ea20),{maxEntries:10,maxCacheBytes:Buffer.byteLength(JSON.stringify(ea20))+1});await byBytes.get(a);await byBytes.get(b);assert.equal(byBytes.cache.size,1);assert.ok(byBytes.cache.has(b));assert.ok(byBytes.health().cacheBytes<=byBytes.maxCacheBytes);
});

test('persistência agrupa writes concorrentes, skips idênticos e flush inclui alterações no fim do worker',async t=>{
 const path=await directory(t),client=tse(async()=>reply(ea20),{dataDir:path});await Promise.all(['a','b','c'].map(name=>client.get(url(name))));assert.equal(client.metrics.persistenceWrites,1);
 await client.persist();assert.equal(client.metrics.persistenceWrites,1);assert.equal(client.metrics.persistenceSkipped,1);
 const first=client.persist().then(async()=>{client.cooldownUntil=123456789;await client.persist();});await first;await client.flush();const saved=JSON.parse(await readFile(join(path,'tse-cache.json'),'utf8'));assert.equal(saved.cooldownUntil,123456789);assert.equal(saved.entries.length,3);
 const writes=client.metrics.persistenceWrites;for(let i=0;i<10;i++)await client.get(url('c'));await client.flush();assert.equal(client.metrics.persistenceWrites,writes);
});

test('histórico global fica bounded por bytes sem alterar votos dos pontos recentes',async()=>{
 const client=tse(async()=>reply(ea20),{maxHistoryBytes:1300,historyCandidates:1});await client.get(resultUrl);
 for(let i=0;i<12;i++){const entry=client.cache.get(resultUrl);entry.raw.idg=String(i);await client.history(resultUrl,normalizeResult(entry.raw,query,election),{...client.source(resultUrl,entry,'cached'),generationId:String(i)});}
 const history=client.cache.get(resultUrl).history;assert.ok(history.length>0&&history.length<12);assert.equal(history.at(-1).id,'11');assert.equal(history.at(-1).candidates[0].votes,0);assert.ok(Buffer.byteLength(JSON.stringify(history))<1300);
});

test('normalizações de resultado/config/EA12 e soma regional são reutilizadas, sem mutação entre consumidores',async()=>{
 let calls=0;const client=tse(async url=>{calls++;return reply(url===CONFIG_URL?ea11:url.includes('/config/')?ea12:url.includes('/dados/br/')?ea20:ufResult(url.match(/\/dados\/([a-z]{2})\//)[1]));}),service=new ElectionService(client);
 const first=await service.results(query),normalizations=service.metrics.normalizations;first.data.candidates[0].name='mutated';const second=await service.results(query);assert.equal(service.metrics.normalizations,normalizations);assert.notEqual(second.data.candidates[0].name,'mutated');assert.equal(calls,2);
 const resolved=await service.resolve({...query,uf:'sp'}),municipal=await service.municipalitiesFor(resolved);const count=service.metrics.normalizations;municipal.municipalities[0].name='mutated';assert.notEqual((await service.municipalitiesFor(resolved)).municipalities[0].name,'mutated');assert.equal(service.metrics.normalizations,count);
 const regional={...query,region:'Sul'};const [r1,r2]=await Promise.all([service.results(regional),service.results(regional)]);assert.equal(service.metrics.regionalBuilds,1);r1.data.candidates[0].name='mutated';assert.notEqual(r2.data.candidates[0].name,'mutated');const oldChecked=r2.source.checkedAt;await service.results(regional);assert.equal(service.metrics.regionalBuilds,1);assert.equal(service.metrics.regionalHits,1);assert.equal((await service.results(regional)).source.checkedAt,oldChecked);
 await assert.rejects(()=>service.results({...query,turn:2}),/não disponível/);
});

test('IBGE conditional revalidation preserva geometria e não renormaliza 304 ou hits',async t=>{
 const path=await directory(t);let now=100000,status=200;const headers=[];
 const geo=new GeographyClient({dataDir:path,minInterval:0,ttl:1000,now:()=>now,fetchImpl:async(url,options)=>{headers.push(options.headers);return reply(url.includes('/malhas/')?geometry:localities,status,{etag:'"ibge"','last-modified':'Sunday'});}});
 const first=await geo.get('sp'),normalized=geo.metrics.normalizations,writes=geo.metrics.persistenceWrites;await geo.get('sp');assert.equal(geo.metrics.normalizations,normalized);assert.equal(geo.metrics.persistenceWrites,writes);
 now+=1001;status=304;const checked=await geo.get('sp');assert.equal(checked.collection,first.collection);assert.equal(checked.geography.state,'cached');assert.equal(checked.geography.retrievedAt,first.geography.retrievedAt);assert.equal(geo.metrics.normalizations,normalized);assert.equal(headers.at(-1)['If-None-Match'],'"ibge"');assert.equal(headers.at(-1)['If-Modified-Since'],'Sunday');
 const restored=new GeographyClient({dataDir:path,minInterval:0,ttl:1000,now:()=>now,fetchImpl:async()=>{throw new Error('No network');}});assert.equal((await restored.get('sp')).geography.state,'cached');await restored.get('sp');assert.equal(restored.metrics.diskReads,1);assert.equal(restored.metrics.normalizations,1);
});

test('IBGE falha inicial/backoff/cooldown são persistidos sem promover cache velho',async t=>{
 const path=await directory(t);let now=100000,calls=0;const geo=new GeographyClient({dataDir:path,minInterval:0,now:()=>now,fetchImpl:async()=>{calls++;return reply({},429);}});const unavailable=await geo.get('sp');assert.equal(unavailable.geography.state,'unavailable');assert.equal(unavailable.geography.nextRetryAt,new Date(now+600000).toISOString());await geo.flush();
 const restored=new GeographyClient({dataDir:path,minInterval:0,now:()=>now,fetchImpl:async()=>{throw new Error('Must not fetch');}});assert.equal((await restored.get('mg')).geography.state,'unavailable');assert.equal(restored.cooldownUntil,now+600000);assert.equal((await restored.get('sp')).geography.nextRetryAt,unavailable.geography.nextRetryAt);
 let status=200;const hot=new GeographyClient({dataDir:null,minInterval:0,ttl:30*86400000,now:()=>now,fetchImpl:async url=>{calls++;return reply(url.includes('/malhas/')?geometry:localities,status);}});await hot.get('sp');now+=30*86400000;status=503;assert.equal((await hot.get('sp')).geography.state,'stale');const before=calls;now+=300001;status=304;assert.equal((await hot.get('sp')).geography.state,'cached');assert.equal(calls,before+2);
});

test('mapas coalescem montagem, reutilizam vínculo/preview e isolam mutações',async()=>{
 let downloads=0;const geo=new GeographyClient({dataDir:null,minInterval:0,fetchImpl:async url=>{downloads++;return reply(url.includes('/malhas/')?geometry:localities);}}),service=new ElectionService(tse(async url=>reply(url===CONFIG_URL?ea11:ea12))),maps=new MunicipalMapService(service,geo),q={...query,uf:'sp'};
 const [a,b]=await Promise.all([maps.map(q),maps.map(q)]);assert.equal(maps.metrics.mapBuilds,1);assert.equal(downloads,2);a.collection.features[0].properties.name='mutated';assert.notEqual(b.collection.features[0].properties.name,'mutated');await maps.map(q);assert.equal(maps.metrics.mapBuilds,1);assert.equal(maps.metrics.mapHits,1);
 const preview=await maps.preview('sp');assert.ok(preview.collection.features.every(f=>f.properties.tseId===null));await maps.preview('sp');assert.equal(maps.metrics.mapBuilds,2);assert.equal(downloads,2);
});

test('IBGE memória LRU/bytes e disco bounded descartam só arquivos de cache UF conhecidos',async t=>{
 const path=await directory(t);let now=100000;
 // Small schema-only geographic fixtures exercise limits without downloading UFs.
 const tiny=uf=>{const prefix=STATES.find(s=>s.uf===uf).ibge,id=prefix+'00001';return {geometry:{type:'FeatureCollection',features:[{type:'Feature',properties:{codarea:id},geometry:geometry.features[0].geometry}]},localities:[{id:Number(id),nome:'Unit-test locality'}]};};
 const geo=new GeographyClient({dataDir:path,minInterval:0,now:()=>now,maxEntries:2,maxDiskBytes:1,fetchImpl:async url=>{const code=url.match(/(?:estados\/)(\d+)/)[1],uf=STATES.find(s=>s.ibge===code).uf,value=tiny(uf);return reply(url.includes('/malhas/')?value.geometry:value.localities);}});
 await writeFile(join(path,'do-not-delete.txt'),'keep');await geo.get('sp');now++;await geo.get('mg');now++;await geo.get('sp');now++;await geo.get('rj');assert.ok(geo.cache.has('sp'));assert.ok(!geo.cache.has('mg'));assert.ok(geo.cache.size<=2);await geo.flush();
 const files=(await readdir(path)).filter(name=>/^[a-z]{2}\.json$/.test(name));const bytes=(await Promise.all(files.map(name=>stat(join(path,name))))).reduce((n,s)=>n+s.size,0);assert.ok(bytes<=1);assert.equal(files.length,0);assert.equal(await readFile(join(path,'do-not-delete.txt'),'utf8'),'keep');
 const bounded=new GeographyClient({dataDir:null,minInterval:0,maxCacheBytes:100,fetchImpl:async url=>reply(url.includes('/malhas/')?geometry:localities)});const result=await bounded.get('sp');assert.equal(result.collection.features.length,645);assert.equal(bounded.cache.size,0);
});
