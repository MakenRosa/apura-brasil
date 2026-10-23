import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG_URL,CONFIG_TTL,CALENDAR_URL} from '../server/constants.mjs';
import {TseClient} from '../server/client.mjs';
import {ElectionService} from '../server/service.mjs';
import {GeographyClient,MunicipalMapService,parsePreviewUf} from '../server/geography.mjs';
import {createServer} from '../server/index.mjs';

const fixture=async name=>JSON.parse(await readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8'));
const [ea11,geometry,localities]=await Promise.all(['ea11-official.json','ibge-sp-malha.json','ibge-sp-localidades.json'].map(fixture));
const copy=value=>structuredClone(value);
const response=(raw,status=200,headers={})=>new Response(status===304?null:JSON.stringify(raw),{status,headers:{'content-type':'application/json',...headers}});
const query={cycle:'ele2026',turn:2,office:'1',uf:'br'};
// Unit-test configuration changes below are never application fixtures or published
// election IDs. They exercise a future EA11 publication without live requests.
function withSecondRound() {
 const config=copy(ea11),original=config.pl.find(pl=>pl.c==='ele2026'),pl=copy(original);
 pl.dt='25/10/2026';pl.e=[copy(original.e.find(e=>e.cd==='6257'))];Object.assign(pl.e[0],{cd:'9001',t:'2',nm:'Configuração de teste segundo turno'});config.pl.push(pl);return config;
}
function client(fetchImpl,options={}){return new TseClient({dataDir:null,minInterval:0,fetchImpl,...options});}
const mockGeography=options=>new GeographyClient({dataDir:null,minInterval:0,fetchImpl:async url=>response(url.includes('/malhas/')?geometry:localities),...options});

test('calendário informa turno eventual sem acrescentar eleição, UF, candidatura ou ID de resultado',async()=>{
 const calls=[],service=new ElectionService(client(async url=>{calls.push(url);return response(ea11);}));
 const bootstrap=await service.bootstrap(),scheduled=bootstrap.scheduledRounds[0];
 assert.deepEqual(scheduled,{cycle:'ele2026',turn:2,date:'2026-10-25',officeIds:['1','3'],state:'awaiting-config',source:{label:'Calendário eleitoral TSE 2026 — eventual segundo turno',url:CALENDAR_URL}});
 assert.ok(!('id' in scheduled)&&!('ufs' in scheduled)&&!('candidates' in scheduled));assert.ok(bootstrap.elections.filter(e=>e.cycle==='ele2026').every(e=>e.turn===1));assert.deepEqual(bootstrap.elections.filter(e=>e.cycle==='ele2026').map(e=>e.id),['6257','6259','6261']);assert.equal(bootstrap.defaultQuery.turn,1);
 await assert.rejects(()=>service.results(query),/não disponível/);await assert.rejects(()=>service.results({...query,electionId:'6257'}),/não disponível/);await assert.rejects(()=>service.resolve({...query,office:'3',uf:'sp'}),/não disponível/);
 assert.deepEqual(calls,[CONFIG_URL]);
});

test('configuração ausente ou simulada não promove turno agendado a eleição oficial disponível',async()=>{
 const offline=new ElectionService(client(async()=>response({},404)));const bootstrap=await offline.bootstrap();assert.equal(bootstrap.scheduledRounds[0].state,'awaiting-config');assert.ok(bootstrap.elections.every(e=>e.turn===1&&e.fallback));await assert.rejects(()=>offline.resolve(query),/não disponível/);
 const simulated=withSecondRound();simulated.f='s';const simulation=await new ElectionService(client(async()=>response(simulated))).bootstrap();assert.equal(simulation.scheduledRounds[0].state,'awaiting-config');assert.equal(simulation.status.phase,'simulation');
});

test('EA11 segundo turno preserva primeiro e resolve exclusivamente ID/cargo/UF publicados na configuração',async()=>{
 const raw=withSecondRound(),service=new ElectionService(client(async()=>response(raw))),bootstrap=await service.bootstrap();
 assert.equal(bootstrap.scheduledRounds[0].state,'available');assert.deepEqual(bootstrap.elections.filter(e=>e.cycle==='ele2026'&&e.turn===1).map(e=>e.id),['6257','6259','6261']);assert.deepEqual(bootstrap.elections.filter(e=>e.cycle==='ele2026'&&e.turn===2).map(e=>e.id),['9001']);
 const resolved=await service.resolve(query);assert.equal(resolved.election.id,'9001');assert.equal(resolved.election.date,'2026-10-25');assert.equal((await service.resolve({...query,turn:1})).election.id,'6257');
 await assert.rejects(()=>service.resolve({...query,electionId:'6257'}),/não disponível/);await assert.rejects(()=>service.resolve({...query,office:'3',uf:'sp'}),/não disponível/);await assert.rejects(()=>service.resolve({...query,electionId:'9999'}),/não disponível/);
 const unrelated=withSecondRound();unrelated.pl.at(-1).c='ele2024';assert.equal((await new ElectionService(client(async()=>response(unrelated))).bootstrap()).scheduledRounds[0].state,'awaiting-config');
});

test('EA11 é revalidado após cinco minutos, com coalescência e preservação condicional',async()=>{
 let now=100000,raw=ea11;const calls=[];
 const tse=client(async(url,options)=>{calls.push(options.headers);await new Promise(r=>setTimeout(r,1));return response(raw,200,{etag:'"configuration"'});},{now:()=>now}),service=new ElectionService(tse);
 assert.equal((await service.bootstrap()).scheduledRounds[0].state,'awaiting-config');now+=CONFIG_TTL-1;await service.bootstrap();assert.equal(calls.length,1);
 raw=withSecondRound();now++;const updates=await Promise.all([service.bootstrap(),service.bootstrap()]);assert.equal(calls.length,2);assert.equal(calls[1]['If-None-Match'],'"configuration"');assert.ok(updates.every(b=>b.scheduledRounds[0].state==='available'));assert.ok(updates.every(b=>b.elections.some(e=>e.turn===1)));
 now+=CONFIG_TTL;tse.fetchImpl=async()=>response(null,304);const unchanged=await service.bootstrap();assert.equal(unchanged.status.httpStatus,304);assert.equal(unchanged.scheduledRounds[0].state,'available');
});

test('cache de configuração e histórico existente sobrevivem ao restart sem promoção de dados agendados',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-second-round-'));t.after(()=>rm(directory,{recursive:true,force:true}));let now=100000;
 const tse=client(async()=>response(withSecondRound()),{dataDir:directory,now:()=>now});await new ElectionService(tse).bootstrap();
 const legacy={id:'legacy',phase:'official',generatedAt:'2026-10-04T18:00:00',observedAt:'2026-10-04T21:00:00Z',sectionsPercent:50,candidates:[]};tse.cache.get(CONFIG_URL).history=[legacy];await tse.persist();
 let calls=0;const restored=client(async()=>{calls++;throw new Error('Rede proibida no teste');},{dataDir:directory,now:()=>now});const bootstrap=await new ElectionService(restored).bootstrap();assert.equal(calls,0);assert.equal(bootstrap.scheduledRounds[0].state,'available');assert.deepEqual(restored.cache.get(CONFIG_URL).history,[legacy]);assert.ok(bootstrap.elections.some(e=>e.id==='6257'&&e.turn===1));
 now+=CONFIG_TTL;const stale=await new ElectionService(restored).bootstrap();assert.equal(stale.status.state,'stale');assert.equal(stale.scheduledRounds[0].state,'available');assert.deepEqual(restored.cache.get(CONFIG_URL).history,[legacy]);
});

test('preview SP conserva 645 geometrias/nomes IBGE sem resolver TSE nem vincular códigos eleitorais',async()=>{
 let tseCalls=0,ibgeCalls=0;const tse=client(async()=>{tseCalls++;throw new Error('TSE não pode ser consultado pela prévia');});
 const geography=mockGeography({fetchImpl:async url=>{ibgeCalls++;return response(url.includes('/malhas/')?geometry:localities);}}),map=new MunicipalMapService(new ElectionService(tse),geography);
 const result=await map.preview('sp');assert.equal(tseCalls,0);assert.equal(ibgeCalls,2);assert.deepEqual(result.coverage,{total:645,linked:0,unmatched:645});assert.equal(result.municipalitiesSource,null);assert.equal(result.geography.provider,'IBGE');assert.equal(result.geography.state,'live');assert.match(result.geography.message,/segundo turno/);
 assert.ok(result.collection.features.every(f=>f.properties.tseId===null&&f.properties.name&&/^35\d{5}$/.test(f.properties.ibge)));assert.equal(result.collection.features.find(f=>f.properties.ibge==='3550308').properties.name,'São Paulo');assert.ok(!('summary' in result)&&!('candidates' in result));
 const cached=await map.preview('sp');assert.equal(cached.geography.state,'cached');assert.equal(ibgeCalls,2);assert.equal(tseCalls,0);
});

test('preview tem allowlist UF exclusiva e falha IBGE não gera votação ou geometria inventada',async()=>{
 for(const filters of ['','uf=','uf=br','uf=zz','uf=xx','uf=../sp','uf=sp&uf=sp','uf=sp&turn=2','uf=sp&office=1','uf=sp&url=https://example.com','uf=%20sp'])assert.throws(()=>parsePreviewUf(new URLSearchParams(filters)));
 assert.equal(parsePreviewUf(new URLSearchParams('uf=SP')),'sp');
 let calls=0;const map=new MunicipalMapService({resolve:()=>{throw new Error('TSE proibido');}},mockGeography({fetchImpl:async()=>{calls++;return response({},503);}}));
 const result=await map.preview('sp');assert.equal(result.collection,null);assert.equal(result.geography.state,'unavailable');assert.equal(result.municipalitiesSource,null);assert.deepEqual(result.coverage,{total:0,linked:0,unmatched:0});assert.ok(result.geography.warnings.some(w=>w.includes('segundo turno')));assert.equal(calls,2);await map.preview('sp');assert.equal(calls,2);
});

test('preview reutiliza persistência, coalescência e stale do IBGE sem alterar cache eleitoral',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-preview-'));t.after(()=>rm(directory,{recursive:true,force:true}));let now=100000,downloads=0;
 const geo=mockGeography({dataDir:directory,now:()=>now,ttl:1000,fetchImpl:async url=>{downloads++;await new Promise(r=>setTimeout(r,1));return response(url.includes('/malhas/')?geometry:localities);}});
 const map=new MunicipalMapService({resolve:()=>{throw new Error('TSE proibido');}},geo);await Promise.all([map.preview('sp'),map.preview('sp')]);assert.equal(downloads,2);
 const restored=mockGeography({dataDir:directory,now:()=>now,ttl:1000,fetchImpl:async()=>{throw new Error('Offline');}}),restoredMap=new MunicipalMapService(null,restored);
 assert.equal((await restoredMap.preview('sp')).geography.state,'cached');now+=1001;const stale=await restoredMap.preview('sp');assert.equal(stale.geography.state,'stale');assert.equal(stale.collection.features.length,645);assert.equal(stale.coverage.linked,0);assert.equal(stale.municipalitiesSource,null);
});

test('HTTP preview navega só IBGE enquanto results turno2 retorna erro sem baixar EA20',async()=>{
 let tseCalls=0;const tse=client(async()=>{tseCalls++;return response(ea11);});const server=createServer({client:tse,geographyClient:mockGeography(),dataDir:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const response=await fetch(base+'/api/map-preview?uf=sp'),preview=await response.json();assert.equal(response.status,200);assert.equal(preview.collection.features.length,645);assert.equal(tseCalls,0);
  for(const filters of ['uf=br','uf=zz','uf=sp&cycle=ele2026','uf=sp&uf=sp',''])assert.equal((await fetch(base+'/api/map-preview?'+filters)).status,400);assert.equal(tseCalls,0);
  assert.equal((await fetch(base+'/api/results?turn=2&office=1&uf=br')).status,400);assert.equal(tseCalls,1);assert.equal((await(await fetch(base+'/api/bootstrap')).json()).scheduledRounds[0].state,'awaiting-config');assert.equal(tseCalls,1);
 }finally{await new Promise(r=>server.close(r));}
});
