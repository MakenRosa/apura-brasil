import {STATES} from './constants.mjs';
import {list,str} from './normalize.mjs';
import {photoUpstream} from './photo-identity.mjs';

export const REGIONS=['Norte','Nordeste','Centro-Oeste','Sudeste','Sul'];
const numericFields=['sectionsTotal','sectionsCounted','sectionsPending','sectionsInstalled','sectionsNotInstalled','sectionsTallied','sectionsNotTallied','electorate','electorateInstalled','electorateCounted','turnout','abstention','votesTotal','votesValid','votesBlank','votesNull','votesSubJudice','votesNominal','votesPartyList','votesComputed','votesAnnulled','votesNullRegular','votesNullTechnical','votesWithoutCandidate'];
const inputError=message=>Object.assign(new Error(message),{status:400});
const sum=values=>values.length&&values.every(value=>typeof value==='number'&&Number.isFinite(value))?values.reduce((total,value)=>total+value,0):null;
const percentage=(value,total)=>value===null||total===null||total<=0?null:value/total*100;
export function eligibleRegionalStates(query,resolved) {
 if(!REGIONS.includes(query.region)||query.uf!=='br'||query.municipality||!['1','3','5','6','7','8'].includes(query.office))throw inputError('Agregação regional exige uf=br, uma região válida e cargo com resultado estadual, sem município.');
 const rawElection=list(resolved.config.raw?.pl).flatMap(pl=>list(pl.e)).find(e=>str(e.cd)===resolved.election.id);
 const states=STATES.filter(state=>state.region===query.region).filter(state=>{
  if(query.office==='8'&&state.uf!=='df'||query.office==='7'&&state.uf==='df')return false;
  if(!rawElection)return resolved.election.ufs.includes(state.uf)||resolved.election.ufs.includes('br');
  return list(rawElection.abr).some(abr=>[state.uf,'br'].includes(str(abr.cd).toLowerCase())&&list(abr.cp).some(cp=>String(Number(cp.cd))===query.office));
 });
 if(!states.length)throw inputError('Esta região não possui UF elegível para o cargo/pleito selecionado no TSE.');
 return states;
}
export function aggregateRegionalData(query,election,states,samples,complete,warnings) {
 const usable=samples.filter(sample=>sample.data),summary={};
 for(const field of numericFields)summary[field]=complete?sum(usable.map(sample=>sample.data.summary[field])):null;
 summary.sectionsPercent=percentage(summary.sectionsCounted,summary.sectionsTotal);
 summary.turnoutPercent=percentage(summary.turnout,summary.electorateInstalled);
 summary.abstentionPercent=percentage(summary.abstention,summary.electorateInstalled);
 summary.finished=complete&&usable.every(sample=>sample.data.summary.finished);
 summary.defined=false;summary.officialStatus=`Soma regional calculada localmente · ${complete?'todas as UFs incluídas':'cobertura incompleta'}`;
 if(usable.some(sample=>sample.data.summary.votesDisclosed===false))summary.votesDisclosed=false;
 else if(complete)summary.votesDisclosed=true;
 const candidates=[];
 if(query.office==='1') {
  const identities=new Set(usable.flatMap(sample=>sample.data.candidates.map(c=>c.sequence).filter(Boolean)));
  let unresolved=0,incompleteCandidates=0;
  for(const sequence of identities) {
   const members=usable.map(sample=>sample.data.candidates.filter(c=>c.sequence===sequence));
   const template=members.flat()[0],integral=complete&&members.every(rows=>rows.length===1),votes=integral?sum(members.map(rows=>rows[0].votes)):null;
   if(votes===null)incompleteCandidates++;
   candidates.push({...template,id:sequence,votes,percent:percentage(votes,summary.votesComputed),elected:null,status:'Agregação regional; sem definição de eleito regional'});
  }
  for(const sample of usable)for(const candidate of sample.data.candidates.filter(c=>!c.sequence)) {
   unresolved++;candidates.push({...candidate,id:`${sample.uf}:unknown:${candidate.id}`,uf:sample.uf,votes:null,percent:null,elected:null,status:'Identidade oficial insuficiente para agregação regional'});
  }
  if(unresolved)warnings.push(`${unresolved} registros sem sequencial oficial de candidatura não foram somados.`);
  if(incompleteCandidates)warnings.push(`${incompleteCandidates} candidaturas não possuem identidade/votação conhecida em todas as UFs; seus totais regionais são desconhecidos.`);
 }else {
  for(const sample of usable)for(const candidate of sample.data.candidates)candidates.push({...candidate,id:`${sample.uf}:${candidate.id}`,uf:sample.uf,percent:percentage(candidate.votes,summary.votesComputed)});
 }
 candidates.sort((a,b)=>(b.votes??-1)-(a.votes??-1)||a.name.localeCompare(b.name,'pt-BR'));
 const parties=[],partyIds=new Set(usable.flatMap(sample=>sample.data.parties.map(p=>p.id)));
 for(const id of partyIds){const members=usable.map(sample=>sample.data.parties.filter(p=>p.id===id)),template=members.flat()[0];const votes=complete&&members.every(rows=>rows.length===1)?sum(members.map(rows=>rows[0].votes)):null;parties.push({...template,votes,percent:percentage(votes,summary.votesValid),seats:null});}
 return {scope:{uf:'br',region:query.region,name:query.region},election,office:{...election.offices.find(office=>office.id===query.office),seats:null},candidates,parties,summary};
}
export async function collectRegional(service,input,{raw=false}={}) {
 const resolved=await service.resolve(input,{aggregate:true}),query={...input,electionId:resolved.election.id},states=eligibleRegionalStates(query,resolved);
 const samples=await Promise.all(states.map(async state=>{
  const ufQuery={...query,uf:state.uf};delete ufQuery.region;
  const response=await service.results(ufQuery,{raw:true});
  const data=response.raw?service.normalizedResult(response.raw,ufQuery,resolved.election):null;
  for(const candidate of data?.candidates||[])if(candidate.photoUrl)try{candidate.photoSource={provider:'TSE',url:photoUpstream(ufQuery,candidate.sequence,resolved.config.raw)};}catch{delete candidate.photoUrl;delete candidate.photoSource;}
  return {uf:state.uf,name:state.name,query:ufQuery,raw:response.raw,source:response.source,data};
 }));
 const phases=new Set(samples.filter(sample=>sample.raw).map(sample=>sample.source.phase)),mixed=phases.size>1||phases.has('unknown');
 const included=mixed?[]:samples.filter(sample=>sample.data).map(sample=>sample.uf),missing=states.map(state=>state.uf).filter(uf=>!included.includes(uf)),complete=missing.length===0&&!mixed;
 const dates=samples.filter(sample=>included.includes(sample.uf)).map(sample=>sample.source.generatedAt).filter(Boolean).sort();
 const aggregation={kind:'region',region:query.region,states:states.map(state=>state.uf),included,missing,complete,generatedAtMin:dates[0]||null,generatedAtMax:dates.at(-1)||null,sources:samples.map(sample=>({uf:sample.uf,name:sample.name,source:sample.source,included:included.includes(sample.uf)}))};
 const warnings=['Cálculo local a partir dos arquivos estaduais EA20 do TSE; não existe arquivo TSE único para este agrupamento regional. Percentuais de seções usam soma st/soma ts, de candidaturas soma de votos/soma v.vvc, de comparecimento soma c/soma esi.',`Intervalo de geração dos arquivos incluídos: ${aggregation.generatedAtMin||'desconhecido'} a ${aggregation.generatedAtMax||'desconhecido'} (horário original TSE).`,'Histórico regional registra somente snapshots completos oficiais observados localmente, com intervalo e vetor de gerações estaduais; não recompõe publicações anteriores nem pressupõe geração simultânea das UFs.'];
 if(query.office!=='1')warnings.push('Candidaturas estaduais mantêm a situação eleitoral oficial da UF de origem; o agrupamento regional não atribui eleitos.');
 if(missing.length)warnings.push(`UFs sem inclusão segura: ${missing.map(uf=>uf.toUpperCase()).join(', ')}. Os totais dependentes de todas as UFs permanecem desconhecidos.`);
 if(mixed)warnings.push('Fases oficial, simulação ou desconhecida incompatíveis entre UFs: nenhuma soma regional foi produzida.');
 const hidden=samples.some(sample=>sample.data?.summary.votesDisclosed===false);
 if(hidden)warnings.push('TSE ainda não divulgou votação em uma ou mais UFs (dv=n). Totais de votos dependentes dessas UFs permanecem desconhecidos.');
 const unknownDates=samples.filter(sample=>included.includes(sample.uf)&&!sample.source.generatedAt).length;
 if(unknownDates)warnings.push(`${unknownDates} UFs incluídas não possuem data/hora de geração conhecida; o intervalo informado considera somente datas conhecidas.`);
 const state=mixed?'unavailable':samples.some(sample=>included.includes(sample.uf)&&sample.source.state==='stale')?'stale':!complete?(included.length||samples.some(sample=>sample.source.state==='waiting')?'waiting':'unavailable'):hidden?'waiting':samples.some(sample=>sample.source.state==='live')?'live':'cached';
 const fetched=samples.map(sample=>sample.source.fetchedAt).filter(Boolean).sort();
 const checked=samples.map(sample=>sample.source.checkedAt).filter(Boolean).sort();
 const source={state,url:`/api/export.json?${new URLSearchParams(query)}`,phase:mixed?'unknown':[...phases][0]||'unknown',generatedAt:null,generationId:null,fetchedAt:fetched.at(-1)||null,checkedAt:checked.at(-1)||null,message:mixed?'Fases incompatíveis; agregação indisponível.':`Agregação local de ${included.length}/${states.length} UFs elegíveis de ${query.region}.${hidden?' Votação não divulgada em uma ou mais UFs (dv=n).':''}`,warnings,aggregation};
 let data=null;
 if(included.length&&!mixed){const memo=service.regionalData(query,states,samples,resolved.config.raw,resolved.election,complete,()=>{const added=[];return {data:aggregateRegionalData(query,resolved.election,states,samples,complete,added),warnings:added};});data=memo.data;warnings.push(...memo.warnings);}
 const history=await service.client.regionalHistory(query,data,source,samples);
 if(history.some(p=>p.candidatesTruncated))warnings.push(`Histórico regional limitado a ${service.client.historyCandidates} candidaturas por snapshot, priorizadas pela votação; exportação mantém todas.`);
 if(raw)return {raw:{kind:'regional-aggregation',query,data,source,aggregation,files:samples.map(sample=>({uf:sample.uf,name:sample.name,source:sample.source,raw:sample.raw}))},source};
 return {query,data,source,history};
}
