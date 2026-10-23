import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CONFIG_URL,STATES} from '../server/constants.mjs';
import {TseClient} from '../server/client.mjs';
import {ElectionService,parseQuery} from '../server/service.mjs';
import {createServer} from '../server/index.mjs';
import {exportFilename} from '../server/export.mjs';

const fixture=async name=>JSON.parse(await readFile(new URL(`fixtures/${name}`,import.meta.url),'utf8'));
const [ea11,ea20,ea14]=await Promise.all(['ea11-official.json','ea20-official.json','ea14-official.json'].map(fixture));
const copy=value=>structuredClone(value),firstSequence=ea20.carg[0].agr[0].par[0].cand[0].sqcand;
const query=(office='1',region='Sul')=>({cycle:'ele2026',turn:1,office,uf:'br',region,electionId:office==='1'?'6257':'6259'});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
// Statistical changes below are unit-test scenarios derived from the documented EA20
// layout. They are never loaded by the application or represented as live vote results.
function ufFixture(uf,office='1',{weight=100,counted=50,votes=40,turnout=60,phase='o',generated='18:00:00'}={}) {
 const raw=copy(ea20);Object.assign(raw,{ele:office==='1'?'6257':'6259',tpabr:'uf',cdabr:uf,f:phase,hg:generated});raw.carg[0].cd=office;
 Object.assign(raw.s,{ts:String(weight),st:String(counted),snt:String(weight-counted),pstn:String(weight?counted/weight*100:0)});
 Object.assign(raw.e,{te:String(weight),est:String(weight),esi:String(weight),c:String(turnout),a:String(weight-turnout),pcn:String(weight?turnout/weight*100:0),pan:String(weight?(weight-turnout)/weight*100:0)});
 Object.assign(raw.v,{tv:String(weight),vvc:String(weight),vv:String(weight),vnom:String(weight),vl:'0'});
 for(const agr of raw.carg[0].agr)for(const par of agr.par){par.tvtn='0';par.tvtl='0';for(const candidate of par.cand){candidate.vap='0';candidate.pvapn='0';}}
 const first=raw.carg[0].agr[0].par[0];first.tvtn=String(votes);first.cand[0].vap=String(votes);first.cand[0].pvapn=String(weight?votes/weight*100:0);return raw;
}
function harness({mutate,config=ea11,now=()=>100000,delay=0,clientOptions={}}={}) {
 const calls=[];let responses=new Map(),faults=new Map();
 const client=new TseClient({dataDir:null,minInterval:0,now,fetchImpl:async url=>{
  calls.push(url);if(delay)await new Promise(r=>setTimeout(r,delay));if(url===CONFIG_URL)return response(config);
  const match=url.match(/\/dados\/([a-z]{2})\/\1-c(\d{4})-e\d{6}-u\.json$/);
  if(match){const uf=match[1],office=String(Number(match[2]));if(faults.has(uf))return response({},faults.get(uf));const raw=responses.get(`${uf}:${office}`)||ufFixture(uf,office);mutate?.(raw,uf,office);return response(raw);}
  if(url.endsWith('-ab.json')){const raw=copy(ea14);if(url.includes('/6259/'))raw.ele='6259';return response(raw);}
  throw new Error(`URL de teste inesperada: ${url}`);
 },...clientOptions});
 return {client,service:new ElectionService(client),calls,responses,faults};
}
test('região tem nome exato, scope br, cargos estaduais e nenhuma varredura municipal permitida',()=>{
 for(const value of ['region=nordeste','region=Sudeste%20','region=','region=Sul&uf=sp','region=Sul&uf=br&municipality=71072','region=Sul&office=11','region=Sul&office=13','region=Nordeste&office=25'])assert.throws(()=>parseQuery(new URLSearchParams(value)));
 for(const region of ['Norte','Nordeste','Centro-Oeste','Sudeste','Sul'])assert.equal(parseQuery(new URLSearchParams({region})).region,region);
 assert.equal(parseQuery(new URLSearchParams('region=Centro-Oeste&office=8')).office,'8');assert.equal(parseQuery(new URLSearchParams('region=Sul&office=7')).office,'7');
 assert.match(exportFilename(query(),'csv'),/-rsul-e6257\.csv$/);
});
test('somas regionais usam pesos st/ts, vap/vvc e c/esi em vez de média dos percentuais UF',async()=>{
 const h=harness();h.responses.set('pr:1',ufFixture('pr','1',{weight:100,counted:10,votes:10,turnout:20,generated:'17:00:00'}));h.responses.set('rs:1',ufFixture('rs','1',{weight:900,counted:810,votes:810,turnout:810,generated:'19:00:00'}));h.responses.set('sc:1',ufFixture('sc','1',{weight:0,counted:0,votes:0,turnout:0,generated:'18:00:00'}));
 const result=await h.service.results(query()),summary=result.data.summary,candidate=result.data.candidates.find(c=>c.sequence===firstSequence);
 assert.equal(summary.sectionsTotal,1000);assert.equal(summary.sectionsCounted,820);assert.equal(summary.sectionsPercent,82);assert.equal(summary.turnoutPercent,83);assert.equal(summary.abstentionPercent,17);assert.equal(summary.votesComputed,1000);assert.equal(candidate.votes,820);assert.equal(candidate.percent,82);
 assert.deepEqual(result.data.scope,{uf:'br',region:'Sul',name:'Sul'});assert.equal(candidate.elected,null);assert.equal(candidate.name,ea20.carg[0].agr[0].par[0].cand[0].nmu);assert.equal(result.source.aggregation.complete,true);assert.deepEqual(result.source.aggregation.states,['pr','rs','sc']);
 assert.equal(result.source.aggregation.generatedAtMin,'2026-10-03T17:00:00');assert.equal(result.source.aggregation.generatedAtMax,'2026-10-03T19:00:00');assert.equal(result.source.generationId,null);assert.ok(result.source.url.startsWith('/api/export.json?'));assert.equal(result.history.length,1);assert.equal(result.history[0].votesComputed,1000);assert.ok(result.source.warnings.some(w=>w.includes('Histórico regional')));
 assert.equal(h.calls.length,4);assert.ok(!h.calls.some(url=>url.includes('/config/mun-')||url.includes('/dados/br/')));
});
test('UF ausente conserva cobertura explícita e não apresenta somas integrais parciais',async()=>{
 const h=harness();h.faults.set('rs',404);const result=await h.service.results(query());
 assert.equal(result.source.aggregation.complete,false);assert.deepEqual(result.source.aggregation.included,['pr','sc']);assert.deepEqual(result.source.aggregation.missing,['rs']);assert.equal(result.source.state,'waiting');
 assert.equal(result.data.summary.sectionsTotal,null);assert.equal(result.data.summary.votesComputed,null);assert.equal(result.data.summary.votesValid,null);assert.ok(result.data.candidates.every(c=>c.votes===null&&c.percent===null));
 assert.equal(result.source.aggregation.sources.find(s=>s.uf==='rs').included,false);assert.equal(result.source.aggregation.sources.find(s=>s.uf==='rs').source.httpStatus,404);
});
test('campo numérico ausente torna somente a soma dependente desconhecida; zero conhecido permanece zero',async()=>{
 const h=harness({mutate:(raw,uf)=>{if(uf==='rs'){delete raw.s.ts;delete raw.v.vvc;delete raw.e.esi;}}});const result=await h.service.results(query());
 assert.equal(result.source.aggregation.complete,true);assert.equal(result.data.summary.sectionsTotal,null);assert.equal(result.data.summary.sectionsCounted,150);assert.equal(result.data.summary.sectionsPercent,null);assert.equal(result.data.summary.votesComputed,null);assert.equal(result.data.summary.turnoutPercent,null);
 assert.equal(result.data.candidates.find(c=>c.sequence===firstSequence).votes,120);assert.equal(result.data.candidates.find(c=>c.sequence===firstSequence).percent,null);
 const zero=harness({mutate:raw=>{for(const agr of raw.carg[0].agr)for(const par of agr.par)for(const c of par.cand)c.vap='0';}});assert.equal((await zero.service.results(query())).data.candidates.find(c=>c.sequence===firstSequence).votes,0);
});
test('candidatura presidencial ausente, votos desconhecidos ou identidade incompleta não viram voto zero',async()=>{
 for(const scenario of ['missing','votes','identity','duplicate']){
  const h=harness({mutate:(raw,uf)=>{if(uf!=='rs')return;const par=raw.carg[0].agr[0].par[0];if(scenario==='missing')par.cand=[];if(scenario==='votes')delete par.cand[0].vap;if(scenario==='identity')delete par.cand[0].sqcand;if(scenario==='duplicate')par.cand.push(copy(par.cand[0]));}});
  const result=await h.service.results(query()),candidate=result.data.candidates.find(c=>c.sequence===firstSequence);assert.equal(candidate.votes,null,scenario);assert.equal(candidate.percent,null,scenario);assert.equal(result.source.aggregation.complete,true);assert.ok(result.source.warnings.some(w=>w.includes('candidaturas')||w.includes('sequencial')));
  if(scenario==='identity'){const unknown=result.data.candidates.find(c=>c.id.startsWith('rs:unknown:'));assert.equal(unknown.votes,null);assert.equal(unknown.uf,'rs');}
 }
});
test('dv=n mantém seções mas oculta toda votação regional e informa restrição com cobertura N/N',async()=>{
 const h=harness({mutate:(raw,uf)=>{if(uf==='rs')raw.dv='n';}});const result=await h.service.results(query());assert.equal(result.source.aggregation.complete,true);assert.equal(result.source.state,'waiting');assert.match(result.source.message,/dv=n/);assert.equal(result.data.summary.votesDisclosed,false);assert.equal(result.data.summary.sectionsCounted,150);assert.equal(result.data.summary.votesTotal,null);assert.equal(result.data.summary.votesComputed,null);assert.ok(result.data.candidates.every(c=>c.votes===null&&c.percent===null));
 const raw=await h.service.results(query(),{raw:true});assert.ok(raw.source.warnings.some(w=>w.includes('dv=n')));assert.equal(raw.raw.files.find(f=>f.uf==='rs').raw.dv,'n');
});
test('fases diferentes não são somadas; bundle mantém arquivos originais identificados',async()=>{
 const h=harness({mutate:(raw,uf)=>{if(uf==='rs')raw.f='s';}});const result=await h.service.results(query());assert.equal(result.data,null);assert.equal(result.source.phase,'unknown');assert.equal(result.source.state,'unavailable');assert.equal(result.source.aggregation.complete,false);assert.deepEqual(result.source.aggregation.included,[]);assert.equal(result.source.aggregation.missing.length,3);assert.ok(result.source.aggregation.sources.every(s=>!s.included));
 const bundle=(await h.service.results(query(),{raw:true})).raw;assert.equal(bundle.kind,'regional-aggregation');assert.equal(bundle.files.find(f=>f.uf==='rs').raw.f,'s');assert.equal(bundle.files.find(f=>f.uf==='pr').raw.f,'o');assert.ok(!('ele' in bundle));
});
test('fase desconhecida rejeitada no arquivo UF aparece como ausência, sem contaminar somas oficiais',async()=>{
 const h=harness({mutate:(raw,uf)=>{if(uf==='rs')raw.f='x';}});const result=await h.service.results(query());assert.equal(result.source.phase,'official');assert.deepEqual(result.source.aggregation.missing,['rs']);assert.equal(result.data.summary.votesComputed,null);assert.equal(result.source.aggregation.sources.find(s=>s.uf==='rs').source.phase,'unknown');
});
test('cargos estaduais preservam UF e candidatura original, sem colisões ou vencedor regional',async()=>{
 for(const office of ['3','5','6','7']){
  const h=harness(),result=await h.service.results(query(office));const same=result.data.candidates.filter(c=>c.sequence===firstSequence);assert.equal(same.length,3);assert.equal(new Set(same.map(c=>c.id)).size,3);assert.deepEqual(new Set(same.map(c=>c.uf)),new Set(['pr','rs','sc']));assert.ok(same.every(c=>c.name===ea20.carg[0].agr[0].par[0].cand[0].nmu&&c.elected===null));
  assert.ok(same.every(c=>new URL(c.photoUrl,'http://127.0.0.1').searchParams.get('uf')===c.uf));assert.ok(same.every(c=>new URL(c.photoUrl,'http://127.0.0.1').searchParams.get('candidate')===firstSequence));assert.ok(same.every(c=>!c.photoUrl.includes('region=')));assert.equal(result.data.scope.region,'Sul');
 }
});
test('Distrito Federal é elegível só para cargo8; cargo7 Centro-Oeste exclui DF; regiões inelegíveis são rejeitadas',async()=>{
 const district=harness(),result=await district.service.results(query('8','Centro-Oeste'));assert.deepEqual(result.source.aggregation.states,['df']);assert.equal(result.data.candidates[0].uf,'df');assert.ok(!district.calls.some(url=>url.includes('/dados/go/')||url.includes('/dados/br/')));
 await assert.rejects(()=>district.service.results(query('8','Sudeste')),/UF elegível/);
 const state=harness(),stateResult=await state.service.results(query('7','Centro-Oeste'));assert.deepEqual(new Set(stateResult.source.aggregation.states),new Set(['go','mt','ms']));assert.ok(!state.calls.some(url=>url.includes('/dados/df/')));
});
test('eleito estadual é preservado somente como informação oficial da UF, sem eleito regional presidencial',async()=>{
 const h=harness({mutate:(raw,uf)=>{if(uf==='pr')Object.assign(raw.carg[0].agr[0].par[0].cand[0],{e:'s',st:'Eleito'});}});
 const state=await h.service.results(query('3'));assert.equal(state.data.candidates.find(c=>c.uf==='pr'&&c.sequence===firstSequence).elected,true);assert.equal(state.data.candidates.find(c=>c.uf==='pr'&&c.sequence===firstSequence).status,'Eleito');assert.ok(state.source.warnings.some(w=>w.includes('UF de origem')));
 const presidential=await h.service.results(query('1'));assert.equal(presidential.data.candidates.find(c=>c.sequence===firstSequence).elected,null);
});
test('EA11 restringe UFs realmente participantes, sem inserir estados fora do mesmo pleito',async()=>{
 const config=copy(ea11),e=config.pl.flatMap(pl=>pl.e).find(e=>e.cd==='6257');e.abr=[{cd:'rj',cp:[{cd:'1',ds:'Presidente',tp:'1'}]},{cd:'sp',cp:[{cd:'1',ds:'Presidente',tp:'1'}]}];
 const h=harness({config}),result=await h.service.results(query('1','Sudeste'));assert.deepEqual(result.source.aggregation.states,['rj','sp']);assert.equal(h.calls.length,3);assert.ok(!h.calls.some(url=>url.includes('/dados/es/')||url.includes('/dados/mg/')));
});
test('concurrentes regionais coalescem arquivos UF, repetição usa cache e stale identifica geração antiga',async()=>{
 let now=100000;const h=harness({now:()=>now,delay:2});await Promise.all([h.service.results(query()),h.service.results(query())]);assert.equal(h.calls.length,4);await h.service.results(query());assert.equal(h.calls.length,4);
 now+=16000;h.faults.set('rs',503);const result=await h.service.results(query());assert.equal(result.source.state,'stale');assert.equal(result.source.aggregation.complete,true);assert.equal(result.source.aggregation.sources.find(s=>s.uf==='rs').source.state,'stale');assert.equal(result.data.summary.votesComputed,300);assert.equal(result.history.length,1);
});
test('regions filtra EA14 oficial pela região e cargo8 reutiliza DF EA20 sem inventar arquivo nacional',async()=>{
 const h=harness();const rows=await h.service.regions(query('1','Sudeste'));assert.equal(rows.rows.length,4);assert.ok(rows.rows.every(row=>row.region==='Sudeste'));assert.ok(h.calls.some(url=>url.endsWith('/br-e006257-ab.json')));
 const district=harness();await district.service.results(query('8','Centro-Oeste'));const before=district.calls.length,result=await district.service.regions(query('8','Centro-Oeste'));assert.equal(district.calls.length,before);assert.equal(result.rows.length,1);assert.equal(result.rows[0].uf,'df');assert.equal(result.rows[0].sectionsCounted,50);assert.ok(!district.calls.some(url=>url.endsWith('-ab.json')));
});
test('HTTP exports regionais têm nome correto, bundle explícito e CSV identifica percentual calculado/UF',async()=>{
 const h=harness(),server=createServer({client:h.client,service:h.service,dataDir:null});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,filters='region=Sul&office=3&uf=br&cycle=ele2026&turn=1&electionId=6259';
 try{
  const result=await(await fetch(`${base}/api/results?${filters}`)).json();assert.equal(result.query.region,'Sul');assert.equal(result.data.scope.name,'Sul');
  const exported=await fetch(`${base}/api/export.json?${filters}`);assert.match(exported.headers.get('content-disposition'),/-rsul-e6259\.json/);assert.ok(!exported.headers.get('content-disposition').includes('undefined'));const bundle=await exported.json();assert.equal(bundle.kind,'regional-aggregation');assert.equal(bundle.files.length,3);assert.ok(bundle.files.every(f=>f.raw.tpabr==='uf'&&f.raw.cdabr===f.uf));assert.equal(bundle.data.summary.votesComputed,300);assert.equal(bundle.data.scope.region,'Sul');assert.ok(bundle.source.url.startsWith('/api/export.json?'));
  const raw=await(await fetch(`${base}/api/raw?${filters}`)).json();assert.equal(raw.kind,'regional-aggregation');
  const csvResponse=await fetch(`${base}/api/export.csv?${filters}`),csv=await csvResponse.text();assert.match(csvResponse.headers.get('content-disposition'),/-rsul-e6259\.csv/);assert.ok(csv.includes('Percentual regional calculado'));assert.ok(csv.includes('UF do candidato'));assert.ok(csv.includes('"pr"'));assert.equal(h.calls.length,4);
  assert.equal((await fetch(base+'/api/results?region=Sul&office=11')).status,400);assert.equal((await fetch(base+'/api/results?region=Sul&uf=sp')).status,400);
 }finally{await new Promise(r=>server.close(r));}
});

test('snapshot regional guarda intervalo, vetor UF e denominadores sem inventar data única',async()=>{
 const h=harness();h.responses.set('pr:1',ufFixture('pr','1',{generated:'17:00:00'}));h.responses.set('rs:1',ufFixture('rs','1',{generated:'19:00:00'}));
 const result=await h.service.results(query()),point=result.history[0];
 assert.equal(point.phase,'official');assert.equal(point.generatedAt,null);assert.equal(point.votesValid,300);assert.equal(point.votesComputed,300);assert.equal(point.sectionsPercent,50);
 assert.equal(point.aggregation.generatedAtMin,'2026-10-03T17:00:00');assert.equal(point.aggregation.generatedAtMax,'2026-10-03T19:00:00');assert.deepEqual(point.aggregation.included,['pr','rs','sc']);assert.deepEqual(point.aggregation.missing,[]);assert.equal(point.aggregation.complete,true);
 assert.deepEqual(point.aggregation.generations.map(g=>g.uf),['pr','rs','sc']);assert.ok(point.aggregation.generations.every(g=>g.generationId===ea20.idg));
 const candidate=point.candidates.find(c=>c.id===firstSequence),original=ea20.carg[0].agr[0].par[0].cand[0];assert.equal(candidate.number,original.n);assert.equal(candidate.name,original.nmu);assert.equal(candidate.destination,original.dvt);
 assert.equal(candidate.percent,40);assert.equal(candidate.votes,120);
});

test('dedup regional usa conteúdo e vetor, aceita correção recente com IDG menor e não duplica cache/exports',async()=>{
 let time=100000;const h=harness({now:()=>time,delay:1});const first=await h.service.results(query());
 await Promise.all([h.service.results(query()),h.service.results(query()),h.service.results(query(),{raw:true})]);assert.equal(h.calls.length,4);assert.equal(h.client.regionalHistories.values().next().value.length,1);
 // Same timestamps/IDG but corrected contents are a newly observed snapshot.
 time+=16000;h.responses.set('pr:1',ufFixture('pr','1',{votes:30}));const corrected=await h.service.results(query());assert.equal(corrected.history.length,2);assert.notEqual(first.history[0].id,corrected.history[1].id);assert.equal(corrected.history[1].candidates.find(c=>c.id===firstSequence).votes,110);
 time+=16000;const latest=ufFixture('pr','1',{votes:20,generated:'19:00:00'});latest.idg='1';h.responses.set('pr:1',latest);const updated=await h.service.results(query());assert.equal(updated.history.length,3);assert.equal(updated.history[2].aggregation.generations.find(g=>g.uf==='pr').generationId,'1');assert.equal(updated.history[2].candidates.find(c=>c.id===firstSequence).votes,100);
 assert.notEqual(updated.history[1].id,updated.history[2].id);
});

test('persistência regional restaura sem rede, incluindo snapshots separados do cache descartável',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'apura-history-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 let time=100000;const h=harness({now:()=>time,clientOptions:{dataDir:directory}});const first=await h.service.results(query());
 time+=16000;h.responses.set('pr:1',ufFixture('pr','1',{generated:'19:00:00',votes:50}));const second=await h.service.results(query());assert.equal(second.history.length,2);await h.client.persistChain;
 let attempts=0;const restored=new TseClient({dataDir:directory,minInterval:0,now:()=>time,fetchImpl:async()=>{attempts++;throw new Error('Rede bloqueada neste teste');}});
 const result=await new ElectionService(restored).results(query());assert.equal(attempts,0);assert.deepEqual(result.history,second.history);assert.equal(result.history[0].id,first.history[0].id);assert.equal(result.source.state,'cached');
 const saved=JSON.parse(await readFile(join(directory,'tse-cache.json'),'utf8'));assert.equal(saved.version,1);assert.equal(saved.regionalHistories.length,1);
});

test('histórico regional não registra cobertura parcial, voto oculto, desconhecido ou identidade incompleta',async()=>{
 for(const scenario of ['missingUF','hidden','computed','valid','candidateVotes','identity','candidateMissing','candidateDuplicate','disclosureUnknown','generationUnknown']) {
  const h=harness({mutate:(raw,uf)=>{if(uf!=='rs')return;
   if(scenario==='hidden')raw.dv='n';if(scenario==='computed')delete raw.v.vvc;if(scenario==='valid')delete raw.v.vv;
   const p=raw.carg[0].agr[0].par[0];if(scenario==='candidateVotes')delete p.cand[0].vap;if(scenario==='identity')delete p.cand[0].sqcand;if(scenario==='candidateMissing')p.cand=[];if(scenario==='candidateDuplicate')p.cand.push(copy(p.cand[0]));if(scenario==='disclosureUnknown')delete raw.dv;if(scenario==='generationUnknown')delete raw.hg;
  }});
  if(scenario==='missingUF')h.faults.set('rs',404);const result=await h.service.results(query());assert.deepEqual(result.history,[],scenario);assert.equal(h.client.regionalHistories.size,0,scenario);
 }
});

test('simulação homogênea ou fases incompatíveis não entram no histórico oficial regional',async()=>{
 for(const mixed of [false,true]){
  const h=harness({mutate:(raw,uf)=>{if(!mixed||uf==='rs')raw.f='s';}});const result=await h.service.results(query());assert.equal(result.history.length,0);assert.equal(h.client.regionalHistories.size,0);assert.equal(result.source.phase,mixed?'unknown':'simulation');
 }
});

test('falhas/ocultação posteriores preservam os pontos anteriores sem registrar voto desconhecido',async()=>{
 for(const scenario of ['missing','hidden','mixed','candidate']){
  let time=100000;const h=harness({now:()=>time});const initial=await h.service.results(query()),id=initial.history[0].id;time+=16000;
  if(scenario==='missing')h.faults.set('rs',404);
  else {const raw=ufFixture('rs','1',{generated:'19:00:00'});if(scenario==='hidden')raw.dv='n';if(scenario==='mixed')raw.f='s';if(scenario==='candidate')delete raw.carg[0].agr[0].par[0].cand[0].vap;h.responses.set('rs:1',raw);}
  const result=await h.service.results(query());assert.equal(result.history.length,1,scenario);assert.equal(result.history[0].id,id,scenario);assert.equal(result.history[0].candidates.find(c=>c.id===firstSequence).votes,120);
 }
});

test('cache velho/CDN anterior não cria um snapshot novo, mesmo com geração recente de outra UF',async()=>{
 let time=100000;const h=harness({now:()=>time});const first=await h.service.results(query());
 time+=16000;h.faults.set('rs',503);h.responses.set('pr:1',ufFixture('pr','1',{generated:'19:00:00',votes:50}));const stale=await h.service.results(query());assert.equal(stale.history.length,1);assert.equal(stale.source.state,'stale');assert.equal(stale.history[0].id,first.history[0].id);
 time+=31000;h.faults.delete('rs');h.responses.set('rs:1',ufFixture('rs','1',{generated:'17:00:00'}));const older=await h.service.results(query());assert.equal(older.history.length,1);assert.equal(older.source.state,'stale');
 time+=16000;h.responses.set('rs:1',ufFixture('rs','1',{generated:'19:30:00'}));const recovered=await h.service.results(query());assert.equal(recovered.history.length,2);assert.equal(recovered.history[1].aggregation.generatedAtMax,'2026-10-03T19:30:00');
});

test('regiões, cargos, turno, eleição, ciclo e conjunto de UFs têm chaves históricas separadas',async()=>{
 const h=harness();const south=await h.service.results(query()),north=await h.service.results(query('1','Norte')),governor=await h.service.results(query('3'));
 assert.equal(h.client.regionalHistories.size,3);assert.equal(south.history[0].aggregation.region,'Sul');assert.equal(north.history[0].aggregation.region,'Norte');assert.ok(governor.history[0].candidates.every(c=>c.uf));
 const samples=south.source.aggregation.sources.map(s=>({uf:s.uf,source:s.source,raw:h.client.cache.get(s.source.url).raw}));
 for(const changes of [{turn:2},{electionId:'9999'},{cycle:'ele2022'}])await h.client.regionalHistory({...south.query,...changes},south.data,south.source,samples);
 assert.equal(h.client.regionalHistories.size,6);
 const narrowed=copy(south.source);narrowed.aggregation.states=['pr','sc'];narrowed.aggregation.included=['pr','sc'];narrowed.aggregation.sources=narrowed.aggregation.sources.filter(s=>s.uf!=='rs');
 await h.client.regionalHistory(south.query,south.data,narrowed,samples.filter(s=>s.uf!=='rs'));assert.equal(h.client.regionalHistories.size,7);
});

test('retenção regional limita snapshots, candidaturas e recortes persistidos',async()=>{
 let time=100000;const h=harness({now:()=>time,clientOptions:{historyLimit:2,historyCandidates:2,maxEntries:4}});
 for(let index=0;index<4;index++){time+=16000;h.responses.set('pr:1',ufFixture('pr','1',{generated:`${18+index}:00:00`,votes:40+index}));await h.service.results(query());}
 const history=(await h.service.results(query())).history;assert.equal(history.length,2);assert.ok(history.every(p=>p.candidates.length===2&&p.candidatesTruncated));assert.equal(history[0].aggregation.generatedAtMax,'2026-10-03T20:00:00');assert.equal(history[1].aggregation.generatedAtMax,'2026-10-03T21:00:00');
 // Lower-level retention receives already validated observations; vary query identity only.
 const result=await h.service.results(query()),samples=result.source.aggregation.sources.map(s=>({uf:s.uf,source:s.source,raw:h.client.cache.get(s.source.url)?.raw}));
 for(const electionId of ['100','101','102','103','104'])await h.client.regionalHistory({...result.query,electionId},result.data,result.source,samples);
 assert.equal(h.client.regionalHistories.size,4);
});

test('histórico normal adiciona denominadores/metadados e enriquece só a geração atual legada',async()=>{
 const h=harness(),leaf={...query(),uf:'pr'};delete leaf.region;
 const current=await h.service.results(leaf),entry=h.client.cache.get(current.source.url),point=copy(current.history[0]);
 assert.equal(point.votesValid,100);assert.equal(point.votesComputed,100);assert.ok(point.candidates.every(c=>c.name&&c.number));
 const legacy={...copy(point),id:'older',candidates:point.candidates.map(({id,votes,percent})=>({id,votes,percent}))};delete legacy.votesValid;delete legacy.votesComputed;
 const currentLegacy={...copy(legacy),id:point.id};entry.history=[legacy,currentLegacy];const enriched=await h.service.results(leaf);
 assert.equal(enriched.history[0].votesComputed,undefined);assert.equal(enriched.history[0].candidates[0].name,undefined);assert.equal(enriched.history[1].votesComputed,100);assert.equal(enriched.history[1].votesValid,100);assert.equal(enriched.history[1].candidates[0].name,point.candidates[0].name);
 assert.equal(enriched.history[1].observedAt,currentLegacy.observedAt);assert.equal(enriched.history[1].candidates[0].percent,legacy.candidates[0].percent);
});
