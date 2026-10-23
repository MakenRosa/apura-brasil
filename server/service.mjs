import { BASE, CONFIG_URL, CONFIG_TTL, CALENDAR_URL, DOC_URL, FALLBACK_ELECTIONS, OFFICES, STATES, UF_CODES, VERSION, scopeName } from './constants.mjs';
import { assertOfficialUrl } from './client.mjs';
import { list, str, normalizeConfig, normalizeResult, normalizeRegions, normalizeMunicipalities } from './normalize.mjs';
import {photoUpstream} from './photo-identity.mjs';
import {REGIONS,collectRegional,eligibleRegionalStates} from './regional.mjs';

export class InputError extends Error { constructor(message){super(message);this.status=400;} }
export function parseQuery(searchParams,{discovery=false,aggregate=false}={}) {
 const allowed=new Set(['cycle','turn','office','uf','municipality','electionId','region']);
 for(const key of searchParams.keys())if(!allowed.has(key)||searchParams.getAll(key).length!==1)throw new InputError('Parâmetro de consulta inválido ou repetido.');
 const cycle=searchParams.get('cycle')||'ele2026',turnText=searchParams.get('turn')||'1',officeText=searchParams.get('office')||'1',uf=(searchParams.get('uf')||'br').toLowerCase(),municipality=searchParams.get('municipality')||undefined,electionId=searchParams.get('electionId')||undefined,region=searchParams.has('region')?searchParams.get('region'):undefined;
 if(!/^ele\d{4}$/.test(cycle)||!['1','2'].includes(turnText)||!/^\d{1,4}$/.test(officeText)||!UF_CODES.has(uf)||municipality&&!/^\d{5}$/.test(municipality)||electionId&&!/^\d{1,6}$/.test(electionId))throw new InputError('Ciclo, turno, cargo, UF ou código TSE de município inválido.');
 const office=String(Number(officeText));
 if(region!==undefined&&(!REGIONS.includes(region)||uf!=='br'||municipality||!['1','3','5','6','7','8'].includes(office)))throw new InputError('Região exige uf=br, nome exato de região e cargo estadual/nacional, sem município.');
 if(!OFFICES.some(o=>o.id===office))throw new InputError('Cargo não suportado.');
 if(uf==='br'&&((office!=='1'&&!aggregate&&!region)||municipality))throw new InputError('Abrangência Brasil está disponível para Presidente. Selecione uma UF para este cargo.');
 if(['11','13','25'].includes(office)&&!municipality&&!discovery)throw new InputError('Este cargo exige um município.');
 if(!region&&(office==='8'&&uf!=='df'||office==='7'&&uf==='df'))throw new InputError('Deputado Distrital exige DF; Deputado Estadual exige outra UF.');
 if(office==='25'&&uf!=='pe')throw new InputError('Conselheiro Distrital: selecione Pernambuco e o município participante da eleição.');
 if(uf==='zz'&&office!=='1')throw new InputError('Exterior está disponível apenas para Presidente.');
 return {cycle,turn:Number(turnText),office,uf,...(municipality?{municipality}:{}),...(electionId?{electionId}:{}),...(region?{region}:{})};
}
export function buildUrl(kind,query,election,rawConfig) {
 const padded=election.id.padStart(6,'0');
 const fallback=kind==='cm'?'<base>/<ambiente>/<ciclo>/<cd_eleicao>/config':'<base>/<ambiente>/<ciclo>/<cd_eleicao>/dados/<uf>';
 let directory=list(rawConfig?.arq).find(x=>x.tp===kind)?.dir||fallback;
 const replacements={'<base>':BASE,'<ambiente>':'oficial','<ciclo>':query.cycle,'<cd_eleicao>':election.id,'<uf>':query.uf};
 for(const [token,value] of Object.entries(replacements))directory=directory.split(token).join(value);
 if(directory.includes('<')||directory.includes('>'))throw new Error('Diretório TSE não suportado.');
 const filename=kind==='cm'?`mun-e${padded}-cm.json`:kind==='ab'?`${query.uf}-e${padded}-ab.json`:`${query.uf}${query.municipality||''}-c${query.office.padStart(4,'0')}-e${padded}-u.json`;
 return assertOfficialUrl(`${directory}/${filename}`);
}
export class ElectionService {
 constructor(client){this.client=client;this.normalized=new WeakMap();this.regionalInflight=new Map();this.regionalDataCache=new Map();this.metrics={normalizations:0,memoHits:0,regionalBuilds:0,regionalHits:0};}
 regionalData(query,states,samples,config,election,complete,compute) {
  const key=JSON.stringify([query,states.map(s=>s.uf),election,complete]),refs=[config,...samples.map(s=>s.raw)],old=this.regionalDataCache.get(key);
  if(old&&refs.every((ref,index)=>(ref??null)===(old.refs[index]?.deref()??null))){this.metrics.regionalHits++;this.regionalDataCache.delete(key);this.regionalDataCache.set(key,old);return structuredClone(old.value);}
  const value=compute();this.metrics.regionalBuilds++;const bytes=Buffer.byteLength(JSON.stringify(value));
  if(bytes<=8*1024*1024){this.regionalDataCache.delete(key);this.regionalDataCache.set(key,{refs:refs.map(ref=>ref?new WeakRef(ref):null),value,bytes});let total=[...this.regionalDataCache.values()].reduce((n,r)=>n+r.bytes,0);while(this.regionalDataCache.size>32||total>8*1024*1024){const first=this.regionalDataCache.keys().next().value;total-=this.regionalDataCache.get(first).bytes;this.regionalDataCache.delete(first);}}
  return structuredClone(value);
 }
 memo(raw,key,compute) {
  let entries=this.normalized.get(raw);if(!entries){entries=new Map();this.normalized.set(raw,entries);}
  if(entries.has(key)){this.metrics.memoHits++;const value=entries.get(key);entries.delete(key);entries.set(key,value);return value;}
  const value=compute();this.metrics.normalizations++;entries.set(key,value);while(entries.size>64)entries.delete(entries.keys().next().value);return value;
 }
 normalizedResult(raw,query,election,municipalityName) {
  const key=`result:${JSON.stringify([query.cycle,query.turn,query.office,query.uf,query.municipality||'',query.electionId||election.id,municipalityName||'',election])}`;
  return structuredClone(this.memo(raw,key,()=>normalizeResult(raw,query,election,municipalityName)));
 }
 async config() {
  const response=await this.client.get(CONFIG_URL,{ttl:CONFIG_TTL,validationKey:'EA11',validate:raw=>Array.isArray(raw.pl)&&Array.isArray(raw.arq)});
  const elections=response.raw?structuredClone(this.memo(response.raw,'config',()=>normalizeConfig(response.raw))):structuredClone(FALLBACK_ELECTIONS);
  return {...response,elections};
 }
 async bootstrap() {
  const config=await this.config();
  const warnings=[...(config.source.warnings||[])];
  if(!config.raw)warnings.push('Configuração EA11 indisponível. Filtros limitados aos códigos do 1º turno de 2026 publicados pelo TSE; nenhum voto substituído.');
  const preferred=config.elections.find(e=>e.cycle==='ele2026'&&e.turn===1&&e.offices.some(o=>o.id==='1'))||config.elections.find(e=>e.offices.some(o=>o.id==='1'));
  const scheduledRounds=[{cycle:'ele2026',turn:2,date:'2026-10-25',officeIds:['1','3'],state:config.raw&&config.source.phase==='official'&&config.elections.some(e=>e.cycle==='ele2026'&&e.turn===2&&e.offices.some(o=>['1','3'].includes(o.id)))?'available':'awaiting-config',source:{label:'Calendário eleitoral TSE 2026 — eventual segundo turno',url:CALENDAR_URL}}];
  return {elections:config.elections,scheduledRounds,offices:OFFICES,states:STATES,status:{...config.source,warnings},defaultQuery:{cycle:preferred?.cycle||'ele2026',turn:preferred?.turn||1,office:'1',uf:'br',...(preferred?{electionId:preferred.id}:{})},app:{name:'Apura Brasil',version:VERSION},sources:[{label:'Resultados oficiais do TSE',url:BASE},{label:'Configuração das eleições (EA11)',url:CONFIG_URL},{label:'Documentação técnica TSE 2026',url:DOC_URL},{label:'Calendário eleitoral TSE 2026',url:CALENDAR_URL}]};
 }
 async resolve(query,{aggregate=false}={}) {
  const config=await this.config();
  const matches=config.elections.filter(e=>e.cycle===query.cycle&&e.turn===query.turn&&e.offices.some(o=>o.id===query.office)&&(!query.electionId||e.id===query.electionId)&&(e.ufs.includes(query.uf)||e.ufs.includes('br')||aggregate&&query.uf==='br'));
  if(matches.length!==1)throw new InputError(matches.length?'Informe a eleição para distinguir os pleitos disponíveis.':'Eleição/cargo não disponível nesta configuração TSE.');
  const election=matches[0],rawElection=list(config.raw?.pl).flatMap(p=>list(p.e)).find(e=>str(e.cd)===election.id);
  const restriction=list(rawElection?.abr).find(a=>str(a.cd).toLowerCase()===query.uf);
  if(query.municipality&&list(restriction?.mu).length&&!restriction.mu.some(m=>str(m.cd).padStart(5,'0')===query.municipality))throw new InputError('Município não participa desta eleição/turno.');
  return {config,election,query:{...query,electionId:election.id}};
 }
 async municipalitiesFor(resolved) {
  const {query,election,config}=resolved;
  if(query.uf==='br')throw new InputError('Selecione uma UF para listar municípios.');
  const url=buildUrl('cm',query,election,config.raw);
  const response=await this.client.get(url,{ttl:3600000,validationKey:`EA12:${query.uf}`,validate:raw=>Array.isArray(raw.abr)});
  let municipalities=response.raw?structuredClone(this.memo(response.raw,`municipalities:${query.uf}`,()=>normalizeMunicipalities(response.raw,query.uf))):[];
  const rawElection=list(config.raw?.pl).flatMap(p=>list(p.e)).find(e=>str(e.cd)===election.id);
  const restriction=list(rawElection?.abr).find(a=>str(a.cd).toLowerCase()===query.uf);
  if(list(restriction?.mu).length){const eligible=new Set(restriction.mu.map(m=>str(m.cd).padStart(5,'0')));municipalities=municipalities.filter(m=>eligible.has(m.id));}
  return {municipalities,source:response.source,raw:response.raw};
 }
 async municipalities(query) {
  // A municipality list is a discovery route: municipal offices need no selected municipality yet.
  const resolved=await this.resolve(query);const response=await this.municipalitiesFor(resolved);
  return {municipalities:response.municipalities,source:response.source};
 }
 async results(input,{raw=false}={}) {
  if(input.region) {
   const key=JSON.stringify([input.cycle,input.turn,input.office,input.uf,input.municipality||'',input.electionId||'',input.region,raw]);
   if(!this.regionalInflight.has(key))this.regionalInflight.set(key,collectRegional(this,input,{raw}).finally(()=>this.regionalInflight.delete(key)));
   return structuredClone(await this.regionalInflight.get(key));
  }
  const resolved=await this.resolve(input);const {query,election,config}=resolved;
  let municipal;
  if(query.municipality||query.uf==='zz'||query.office==='25') {
   municipal=await this.municipalitiesFor(resolved);
   if(!municipal.raw)return raw?{raw:null,source:municipal.source}:{query,data:null,source:municipal.source,history:[]};
   if(!municipal.municipalities.length||query.municipality&&!municipal.municipalities.some(m=>m.id===query.municipality))throw new InputError('UF ou município não participa desta eleição no arquivo EA12.');
  }
  const url=buildUrl('u',query,election,config.raw);
  const validationKey=`EA20:${JSON.stringify([query.cycle,query.turn,query.office,query.uf,query.municipality||'',election])}`;
  const response=await this.client.get(url,{validationKey,validate:payload=>{
   try{this.normalizedResult(payload,query,election);return true;}catch{return false;}
  }});
  if(raw)return {raw:response.raw,source:response.source};
  const data=response.raw?this.normalizedResult(response.raw,query,election,municipal?.municipalities.find(m=>m.id===query.municipality)?.name):null;
  const source={...response.source,warnings:[...(response.source.warnings||[])]};
  for(const candidate of data?.candidates||[])if(candidate.photoUrl)try{candidate.photoSource={provider:'TSE',url:photoUpstream(query,candidate.sequence,config.raw)};}catch{delete candidate.photoUrl;delete candidate.photoSource;}
  if(election.fallback)source.warnings.push('Eleição resolvida pelos códigos publicados pelo TSE; EA11 está indisponível.');
  if(data?.summary.votesDisclosed===false){source.state=response.source.state==='stale'?'stale':'waiting';source.message='TSE ainda não autorizou a divulgação da votação de Presidente (dv=n).';source.warnings.push('Zeros recebidos em votação não divulgada foram representados como desconhecidos.');}
  if(data&&query.office==='5')source.warnings.push(`${query.cycle==='ele2026'?'Senado: dois votos por eleitor em 2026. ':''}Percentuais de candidatura se referem aos votos computados, não à quantidade de eleitores.`);
  if(data?.parties.length)source.warnings.push('Votos de partido: nominais válidos + legenda válida, quando aplicável. Percentual sobre votos válidos; candidatura usa o percentual TSE de votos computados.');
  const history=data?await this.client.history(url,data,response.source):[];
  if(history.some(p=>p.candidatesTruncated))source.warnings.push(`Histórico local: por geração, até ${this.client.historyCandidates} candidaturas com mais votos; progresso de seções preservado. Exportação bruta contém todos os candidatos.`);
  return {query,data,source,history:structuredClone(history)};
 }
 async regions(input) {
  if(input.region&&input.office==='8') {
   const envelope=await this.results(input),rows=[];
   if(envelope.data){const state=STATES.find(state=>state.uf==='df'),summary=envelope.data.summary;rows.push({uf:'df',name:state.name,region:state.region,sectionsPercent:summary.sectionsPercent,sectionsCounted:summary.sectionsCounted,sectionsTotal:summary.sectionsTotal,finished:summary.finished,generatedAt:envelope.source.aggregation.sources.find(source=>source.uf==='df')?.source.generatedAt||null});}
   return {rows,source:envelope.source};
  }
  const resolved=await this.resolve(input,{aggregate:true}),{query,election,config}=resolved;
  const url=buildUrl('ab',query,election,config.raw);
  const response=await this.client.get(url,{validationKey:`EA14/15:${election.id}:${query.turn}`,validate:raw=>Array.isArray(raw.abr)&&str(raw.ele)===election.id&&Number(raw.t)===query.turn});
  let municipalities=[];
  if(query.uf!=='br'&&response.raw)municipalities=(await this.municipalitiesFor(resolved)).municipalities;
  let rows=response.raw?structuredClone(this.memo(response.raw,`regions:${JSON.stringify([query,municipalities])}`,()=>normalizeRegions(response.raw,query,municipalities))):[];
  if(query.region){const eligible=new Set(eligibleRegionalStates(query,resolved).map(state=>state.uf));rows=rows.filter(row=>row.region===query.region&&eligible.has(row.uf));}
  return {rows,source:response.source};
 }
}
