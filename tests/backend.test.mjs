import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG_URL,FALLBACK_ELECTIONS,BASE} from '../server/constants.mjs';
import {number,pct,phase,generatedAt,normalizeConfig,normalizeResult,normalizeMunicipalities,normalizeRegions} from '../server/normalize.mjs';
import {TseClient,assertOfficialUrl} from '../server/client.mjs';
import {ElectionService,parseQuery,buildUrl} from '../server/service.mjs';
import {createServer} from '../server/index.mjs';
import {csvCell} from '../server/export.mjs';

const fixtures={};
for(const type of ['ea11','ea12','ea14','ea15','ea20'])fixtures[type]=JSON.parse(await readFile(new URL(`fixtures/${type}-official.json`,import.meta.url),'utf8'));
const elections=normalizeConfig(fixtures.ea11),election=elections.find(e=>e.id==='6257');
const query={cycle:'ele2026',turn:1,office:'1',uf:'br',electionId:'6257'};
const resultUrl=buildUrl('u',query,election,fixtures.ea11);
const response=(raw,status=200,headers={})=>new Response(status===304?null:typeof raw==='string'?raw:JSON.stringify(raw),{status,headers:{'content-type':'application/json',...headers}});
const copy=value=>structuredClone(value);
const offline=async()=>{throw new Error('Offline de teste');};
const clientFor=(fetchImpl,options={})=>new TseClient({fetchImpl,dataDir:null,minInterval:0,...options});

test('EA11 oficial resolve federal, estadual, distrital sem confundir eleições',()=>{
 assert.equal(election.cycle,'ele2026');assert.equal(election.turn,1);assert.equal(election.date,'2026-10-04');
 assert.deepEqual(election.offices.map(o=>o.id),['1']);
 assert.deepEqual(elections.find(e=>e.id==='6259').offices.map(o=>o.id),['3','5','6','7','8']);
 assert.equal(elections.find(e=>e.id==='6261').offices[0].id,'25');
 assert.equal(election.fallback,undefined);
});
test('EA20 oficial pré-totalização preserva zeros reais sem inferir eleito',()=>{
 const data=normalizeResult(fixtures.ea20,query,election);
 assert.ok(data.candidates.length>=2);assert.equal(data.summary.sectionsCounted,0);assert.equal(data.summary.sectionsTotal,499248);
 assert.equal(data.summary.votesValid,0);assert.equal(data.summary.votesDisclosed,true);assert.equal(data.summary.finished,false);
 assert.ok(data.candidates.every(c=>c.votes===0&&c.percent===0&&c.elected===null));
 assert.equal(data.office.seats,1);assert.equal(phase(fixtures.ea20),'official');
});
test('ausências e formatos brasileiros: zero não vira null, lixo não vira zero',()=>{
 for(const value of [null,undefined,'','-','abc','NaN',Infinity])assert.equal(number(value),null);
 assert.equal(number('0'),0);assert.equal(number('1.234'),1234);assert.equal(number('1.234,50'),1234.5);
 assert.equal(pct({pvap:'12,50'},'pvap'),12.5);assert.equal(pct({pvapn:'1.234',pvap:'1,23'},'pvap'),1.234);
 assert.equal(pct({pvapn:'12.345678901'},'pvap'),12.345678901);assert.equal(pct({pst:'105'},'pst'),null);
 const raw=copy(fixtures.ea20);delete raw.v.vv;delete raw.s.st;delete raw.carg[0].agr[0].par[0].cand[0].vap;
 const data=normalizeResult(raw,query,election);assert.equal(data.summary.votesValid,null);assert.equal(data.summary.sectionsCounted,null);assert.equal(data.candidates[0].votes,null);
});
test('100% de seções e e=s sem situação não inferem finalização nem eleito',()=>{
 const raw=copy(fixtures.ea20);raw.and='p';raw.s.pstn='100';raw.carg[0].agr[0].par[0].cand[0].e='s';
 const data=normalizeResult(raw,query,election);assert.equal(data.summary.sectionsPercent,100);assert.equal(data.summary.finished,false);assert.equal(data.candidates[0].elected,null);
 raw.carg[0].agr[0].par[0].cand[0].st='2º turno';assert.equal(normalizeResult(raw,query,election).candidates[0].elected,false);
 raw.carg[0].agr[0].par[0].cand[0].st='Eleito por média';assert.equal(normalizeResult(raw,query,election).candidates[0].elected,true);
});
test('dv=n oculta votação em lugar de exibir zeros de sigilo como votos',()=>{
 const raw=copy(fixtures.ea20);raw.dv='n';const data=normalizeResult(raw,query,election);
 assert.equal(data.summary.votesDisclosed,false);assert.equal(data.summary.votesTotal,null);assert.equal(data.summary.votesValid,null);
 assert.ok(data.candidates.every(c=>c.votes===null&&c.percent===null));assert.ok(data.parties.every(p=>p.votes===null));
});
test('contadores adicionais usam somente campos oficiais e todos os votos ficam ocultos com dv=n',()=>{
 const raw=copy(fixtures.ea20);
 Object.assign(raw.s,{si:'42',sni:'3',sa:'40',sna:'2'});
 Object.assign(raw.e,{esi:'4200',est:'4500'});
 Object.assign(raw.v,{vvc:'3900',van:'12',vn:'8',vnt:'3',vscv:'2'});
 const expected={sectionsInstalled:42,sectionsNotInstalled:3,sectionsTallied:40,sectionsNotTallied:2,electorateInstalled:4200,electorateCounted:4500,votesComputed:3900,votesAnnulled:12,votesNullRegular:8,votesNullTechnical:3,votesWithoutCandidate:2};
 const summary=normalizeResult(raw,query,election).summary;
 for(const [key,value] of Object.entries(expected))assert.equal(summary[key],value,key);
 raw.dv='n';const hidden=normalizeResult(raw,query,election).summary;
 for(const key of Object.keys(expected))assert.equal(hidden[key],key.startsWith('votes')?null:expected[key],key);
 delete raw.s.si;delete raw.e.esi;delete raw.v.vvc;raw.dv='s';
 const missing=normalizeResult(raw,query,election).summary;assert.equal(missing.sectionsInstalled,null);assert.equal(missing.electorateInstalled,null);assert.equal(missing.votesComputed,null);
 assert.throws(()=>parseQuery(new URLSearchParams('office=5&uf=zz')),/Exterior/);
});
test('destinação sub judice permanece distinta dos válidos; partido usa tvtn e tvtl válidos',()=>{
 const raw=copy(fixtures.ea20);raw.v.vv='100';raw.v.vansj='30';raw.v.vnom='100';raw.v.tvn='8';raw.v.vn='5';raw.v.vnt='3';
 const par=raw.carg[0].agr[0].par[0];par.tvtn='20';par.tvan='50';par.cand[0].vap='50';par.cand[0].dvt='Anulado sub judice';par.cand[0].pvapn='25';
 const data=normalizeResult(raw,query,election);assert.equal(data.summary.votesValid,100);assert.equal(data.summary.votesSubJudice,30);assert.equal(data.summary.votesNull,8);
 assert.equal(data.candidates[0].votes,50);assert.equal(data.candidates[0].percent,25);assert.equal(data.candidates[0].destination,'Anulado sub judice');
 assert.equal(data.parties[0].votes,20);assert.equal(data.parties[0].percent,20);
 const proportional=copy(election);proportional.offices=[{id:'6',name:'Deputado Federal',type:'proportional'}];raw.carg[0].cd='6';par.tvtl='7';par.tval='99';
 assert.equal(normalizeResult(raw,{...query,office:'6'},proportional).parties[0].votes,27);
});
test('EA20 de outra abrangência, eleição ou cargo é rejeitado',()=>{
 assert.throws(()=>normalizeResult(fixtures.ea20,{...query,uf:'sp'},election),/Abrangência/);
 assert.throws(()=>normalizeResult(fixtures.ea20,{...query,office:'3'},election),/eleição\/cargo/);
 assert.throws(()=>normalizeResult({...fixtures.ea20,ele:'999'},query,election),/eleição\/cargo/);
});
test('data de geração preserva horário original sem UTC inventado',()=>{
 assert.equal(generatedAt(fixtures.ea20),'2026-10-03T14:47:37');assert.equal(generatedAt({dg:'',hg:''}),null);assert.equal(phase({f:'s'}),'simulation');assert.equal(phase({f:'x'}),'unknown');
});
test('EA12 mantém código TSE de cinco dígitos e exterior; EA14/15 não inventam líder',()=>{
 const municipalities=normalizeMunicipalities(fixtures.ea12,'sp');assert.ok(municipalities.length>600);assert.equal(municipalities.find(m=>m.id==='71072').name,'SÃO PAULO');
 assert.ok(normalizeMunicipalities(fixtures.ea12,'zz').length>0);
 const states=normalizeRegions(fixtures.ea14,query);assert.equal(states.length,28);assert.ok(states.every(s=>!s.leader));assert.equal(states.find(s=>s.uf==='sp').sectionsCounted,0);
 const rows=normalizeRegions(fixtures.ea15,{...query,uf:'sp'},municipalities);assert.equal(rows.length,645);assert.ok(rows.some(r=>r.name==='SÃO PAULO'));assert.ok(rows.every(r=>!r.leader));
});
test('URL oficial usa padding correto e bloqueia origem/redirect arbitrário',()=>{
 assert.equal(resultUrl,`${BASE}/oficial/ele2026/6257/dados/br/br-c0001-e006257-u.json`);
 assert.equal(buildUrl('u',{...query,uf:'ac',municipality:'01120'},election,fixtures.ea11),`${BASE}/oficial/ele2026/6257/dados/ac/ac01120-c0001-e006257-u.json`);
 for(const url of ['http://resultados.tse.jus.br/oficial/a.json','https://evil.test/oficial/a.json',`${BASE}/oficial/a.json?url=x`,`${BASE}/oficial/../private/a.json`])assert.throws(()=>assertOfficialUrl(url));
 assert.throws(()=>buildUrl('u',query,election,{arq:[{tp:'u',dir:'https://evil.test/steal'}]}));
});
test('query valida escopo, município, duplicatas e permite descoberta municipal',()=>{
 for(const input of ['uf=xx','office=3&uf=br','office=11&uf=sp','office=8&uf=sp','office=7&uf=df','municipality=1120&uf=ac','cycle=../../etc','url=http://evil.test','uf=sp&uf=ac','electionId=abc'])assert.throws(()=>parseQuery(new URLSearchParams(input)));
 assert.equal(parseQuery(new URLSearchParams('uf=SP')).uf,'sp');
 assert.equal(parseQuery(new URLSearchParams('office=25&uf=pe'),{discovery:true}).office,'25');
 assert.equal(parseQuery(new URLSearchParams('office=3&uf=br'),{aggregate:true}).uf,'br');
});
test('requisições simultâneas são coalescidas e cache evita novo fetch',async()=>{
 let calls=0,release;const client=clientFor(async()=>{calls++;await new Promise(r=>release=r);return response(fixtures.ea20);});
 const first=client.get(resultUrl),second=client.get(resultUrl);await new Promise(r=>setImmediate(r));assert.equal(calls,1);release();
 const results=await Promise.all([first,second]);assert.equal(results[0].source.state,'live');assert.equal(results[0],results[1]);
 assert.equal((await client.get(resultUrl)).source.state,'cached');assert.equal(calls,1);
});
test('ETag/Last-Modified enviados e 304 preserva conteúdo, geração e histórico',async()=>{
 let time=1000,calls=0,headers;const client=clientFor(async(url,options)=>{calls++;headers=options.headers;return calls===1?response(fixtures.ea20,200,{etag:'"abc"','last-modified':'Sat, 03 Oct 2026 17:47:37 GMT'}):response(null,304);},{now:()=>time});
 const first=await client.get(resultUrl);await client.history(resultUrl,normalizeResult(first.raw,query,election),first.source);time+=16000;
 const second=await client.get(resultUrl);assert.equal(headers['If-None-Match'],'"abc"');assert.ok(headers['If-Modified-Since']);assert.equal(second.source.httpStatus,304);assert.equal(second.raw.idg,fixtures.ea20.idg);assert.equal(second.entry.history.length,1);
});
test('404 tem backoff por chave crescente sem repetir enquanto aguarda',async()=>{
 let time=100000,calls=0;const client=clientFor(async()=>{calls++;return response('',404);},{now:()=>time});
 let result=await client.get(resultUrl);assert.equal(result.source.state,'waiting');assert.equal(result.entry.retryAt,time+60000);
 time+=59999;await client.get(resultUrl);assert.equal(calls,1);time++;
 result=await client.get(resultUrl);assert.equal(calls,2);assert.equal(result.entry.retryAt,time+120000);
});
test('403 e 429 bloqueiam acesso global por dez minutos sem reiniciar cooldown por consulta local',async()=>{
 for(const status of [403,429]){
  let time=100000,calls=0;const client=clientFor(async()=>{calls++;return response('',status);},{now:()=>time});
  await client.get(resultUrl);const until=client.cooldownUntil;assert.equal(until,time+600000);
  time+=599999;const second=await client.get(CONFIG_URL);assert.equal(calls,1);assert.equal(second.source.state,'unavailable');assert.equal(client.cooldownUntil,until);
  time++;await client.get(CONFIG_URL);assert.equal(calls,2);
 }
});
test('erro de rede/formato preserva último payload como stale',async()=>{
 let time=100000,calls=0;const client=clientFor(async()=>++calls===1?response(fixtures.ea20):response('<html>erro</html>'),{now:()=>time});
 await client.get(resultUrl);time+=16000;const second=await client.get(resultUrl);assert.equal(second.source.state,'stale');assert.equal(second.raw.idg,fixtures.ea20.idg);assert.ok(second.source.nextRetryAt);
 time+=30000;client.fetchImpl=offline;assert.equal((await client.get(resultUrl)).source.state,'stale');
});
test('validação de esquema impede sobrescrever versão boa com arquivo errado',async()=>{
 let time=100000,calls=0;const client=clientFor(async()=>response(++calls===1?fixtures.ea20:{f:'o',carg:[]}),{now:()=>time});
 const validate=raw=>raw.ele==='6257';await client.get(resultUrl,{validate});time+=16000;
 assert.equal((await client.get(resultUrl,{validate})).raw.ele,'6257');
});
test('geração anterior da CDN não regride resultado; IDG menor e votos menores novos são aceitos',async()=>{
 let time=100000,current=copy(fixtures.ea20);current.dg='04/10/2026';current.hg='18:00:00';current.idg='90';current.carg[0].agr[0].par[0].cand[0].vap='100';
 const client=clientFor(async()=>response(current),{now:()=>time});await client.get(resultUrl);
 time+=16000;current.hg='17:59:59';current.idg='999999';current.carg[0].agr[0].par[0].cand[0].vap='99';
 const older=await client.get(resultUrl);assert.equal(older.source.state,'stale');assert.equal(older.raw.hg,'18:00:00');assert.equal(older.raw.idg,'90');assert.match(older.source.message,/geração anterior/);
 assert.equal((await client.get(resultUrl)).source.state,'stale');
 time+=16000;current.hg='18:00:01';current.idg='7';current.carg[0].agr[0].par[0].cand[0].vap='80';
 const newer=await client.get(resultUrl);assert.equal(newer.source.state,'live');assert.equal(newer.raw.idg,'7');assert.equal(newer.raw.carg[0].agr[0].par[0].cand[0].vap,'80');
});
test('timeout cria estado indisponível e backoff sem chamadas em loop',async()=>{
 let calls=0;const client=clientFor(async(url,{signal})=>{calls++;await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));},{timeout:10});
 const keepAlive=setTimeout(()=>{},100);
 try {const result=await client.get(resultUrl);assert.equal(result.source.state,'unavailable');assert.match(result.source.message,/Tempo limite/);await client.get(resultUrl);assert.equal(calls,1);}finally{clearTimeout(keepAlive);}
});
test('histórico limita candidatos, declara corte e registra fase simulada explicitamente',async()=>{
 const raw=copy(fixtures.ea20);raw.f='s';const client=clientFor(async()=>response(raw),{historyCandidates:2});const r=await client.get(resultUrl);
 const data=normalizeResult(raw,query,election);data.candidates[3].votes=999;
 const history=await client.history(resultUrl,data,r.source);assert.equal(history[0].phase,'simulation');assert.equal(history[0].candidatesTruncated,true);assert.equal(history[0].candidates.length,2);assert.equal(history[0].candidates[0].id,data.candidates[3].id);
});
test('fila limita concorrência a três downloads e cooldown pula pedidos já enfileirados',async()=>{
 let active=0,max=0;const client=clientFor(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return response(fixtures.ea20);});
 await Promise.all(Array.from({length:8},(_,i)=>client.get(`${BASE}/oficial/test/dados/key${i}.json`)));
 assert.equal(max,3);assert.equal(client.requests,8);
 let calls=0;const blocked=clientFor(async()=>{calls++;return response('',403);},{minInterval:10});
 await Promise.all([blocked.get(resultUrl),blocked.get(CONFIG_URL)]);assert.equal(calls,1);
});
test('persistência restaura payload/cooldown; histórico deduplica geração sem ordenar IDG',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-cache-'));let time=100000,current=copy(fixtures.ea20);
 try {
  const client=clientFor(async()=>response(current),{dataDir:directory,now:()=>time,historyLimit:2});
  for(const id of ['90','90','7','100']){current.idg=id;time+=16000;const r=await client.get(resultUrl);await client.history(resultUrl,normalizeResult(r.raw,query,election),r.source);}
  assert.deepEqual(client.cache.get(resultUrl).history.map(p=>p.id),['7','100']);
  client.cooldownUntil=time+600000;await client.persist();
  const restored=clientFor(offline,{dataDir:directory,now:()=>time});await restored.ready;
  const view=await restored.get(resultUrl);assert.equal(view.source.state,'stale');assert.equal(view.raw.idg,'100');assert.deepEqual(view.entry.history.map(p=>p.id),['7','100']);assert.equal(restored.requests,0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('service fallback é identificado; falha esperada não produz votos demo',async()=>{
 const service=new ElectionService(clientFor(offline));const bootstrap=await service.bootstrap();
 assert.ok(bootstrap.elections.every(e=>e.fallback));assert.equal(bootstrap.status.state,'unavailable');
 const result=await service.results(query);assert.equal(result.data,null);assert.equal(result.source.state,'unavailable');assert.deepEqual(result.history,[]);
 assert.equal(FALLBACK_ELECTIONS.find(e=>e.id==='6259').offices.find(o=>o.id==='5').seats,undefined);
});
test('service usa EA12 para rejeitar município inexistente sem pedir EA20',async()=>{
 const urls=[];const service=new ElectionService(clientFor(async url=>{urls.push(url);return response(url===CONFIG_URL?fixtures.ea11:fixtures.ea12);}));
 await assert.rejects(()=>service.results({...query,uf:'sp',municipality:'00000'}),/Município|município/);
 assert.equal(urls.length,2);assert.ok(urls[1].endsWith('-cm.json'));
});
test('servidor local API offline, download real e proteção de arquivos',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-static-'));await writeFile(join(directory,'index.html'),'<html>Apura</html>');await mkdir(join(directory,'assets'));await writeFile(join(directory,'assets','a.js'),'export const a=1;');
 const client=clientFor(async url=>response(url===CONFIG_URL?fixtures.ea11:fixtures.ea20));const server=createServer({client,distDir:directory});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const health=await(await fetch(base+'/api/health')).json();assert.equal(health.ok,true);assert.equal(health.service,'apura-brasil');assert.equal(health.pid,process.pid);
  assert.equal((await fetch(base+'/api/results?uf=xx')).status,400);assert.equal((await fetch(base+'/api/nope')).status,404);assert.equal((await fetch(base+'/api/health',{method:'POST'})).status,405);
  assert.equal((await fetch(base+'/api/results?office=3&uf=br')).status,400);
  const result=await(await fetch(base+'/api/results')).json();assert.equal(result.data.candidates.length,normalizeResult(fixtures.ea20,query,election).candidates.length);
  const raw=await fetch(base+'/api/raw');assert.ok(raw.headers.get('content-disposition').includes('.json'));assert.deepEqual(await raw.json(),fixtures.ea20);
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/assets/a.js')).status,200);assert.equal((await fetch(base+'/server/index.mjs')).status,404);
  assert.equal((await fetch(base+'/%5C..%5Cserver%5Cindex.mjs')).status,400);
 }finally{await new Promise(r=>server.close(r));await rm(directory,{recursive:true,force:true});}
});
test('exportações HTTP incluem todos candidatos, fonte, JSON original e protegem fórmulas CSV sem novos fetches',async()=>{
 const raw=copy(fixtures.ea20),candidate=raw.carg[0].agr[0].par[0].cand[0];
 candidate.nmu='  =HYPERLINK("evil";"nome")';candidate.vap='0';delete candidate.pvap;delete candidate.pvapn;
 let calls=0;const client=clientFor(async url=>{calls++;return response(url===CONFIG_URL?fixtures.ea11:raw);});
 const server=createServer({client});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try {
  await fetch(base+'/api/results');assert.equal(calls,2);
  const csv=await fetch(base+'/api/export.csv');assert.equal(csv.status,200);assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(csv.headers.get('content-disposition'),/apura-ele2026-t1-c1-br-mgeral-e6257\.csv/);
  const bytes=new Uint8Array(await csv.arrayBuffer());assert.deepEqual([...bytes.slice(0,3)],[239,187,191]);const text=new TextDecoder().decode(bytes);
  assert.equal(text.split('\r\n').filter(Boolean).length,normalizeResult(raw,query,election).candidates.length+1);
  assert.ok(text.includes(csvCell(candidate.nmu.trim())));assert.ok(text.includes('"official";"cached"'));assert.ok(text.includes(csvCell(resultUrl)));assert.ok(text.includes('"0";"";"Aguardando definição"'));
  for(const value of ['=1+1',' +SUM(A1)','-1','@SUM(A1)','\t=1','\r=1'])assert.ok(csvCell(value).startsWith('"\''),value);
  assert.equal(csvCell('a;b"c'),'"a;b""c"');assert.equal(csvCell(null),'""');assert.equal(csvCell(0),'"0"');
  const jsonResponse=await fetch(base+'/api/export.json');assert.equal(jsonResponse.status,200);assert.match(jsonResponse.headers.get('content-disposition'),/e6257\.json/);assert.deepEqual(await jsonResponse.json(),raw);assert.equal(calls,2);
  assert.equal((await fetch(base+'/api/export.csv?uf=zz&office=5')).status,400);
  client.cache.clear();client.fetchImpl=offline;
  assert.equal((await fetch(base+'/api/export.csv')).status,503);assert.equal((await fetch(base+'/api/export.json')).status,503);
 }finally{await new Promise(r=>server.close(r));}
});
