import { officeById, scopeName, STATES } from './constants.mjs';
import {photoLocalUrl,photoUpstream} from './photo-identity.mjs';
export const list = value => Array.isArray(value)?value:[];
export const str = value => value===null||value===undefined?'':String(value).trim();
export function number(value) {
 if(value===null||value===undefined||value==='') return null;
 if(typeof value==='number') return Number.isFinite(value)&&value>=0?value:null;
 let text=str(value).replace(/%$/,'').trim();
 if(!/^\d+(?:[.,]\d+)*$/.test(text))return null;
 if(text.includes(','))text=text.replace(/\./g,'').replace(',','.');
 else if(/^\d{1,3}(\.\d{3})+$/.test(text))text=text.replace(/\./g,'');
 const n=Number(text);return Number.isFinite(n)&&n>=0?n:null;
}
export const pct = (object,key) => {
 for(const value of [object?.[`${key}n`],object?.[key]]) {
  if(value===null||value===undefined||value==='')continue;
  const text=str(value).replace('%','').replace(',','.');
  if(/^\d+(?:\.\d+)?$/.test(text)){const n=Number(text);if(Number.isFinite(n)&&n>=0&&n<=100)return n;}
 }
 return null;
};
export const dateOnly = value => /^(\d{2})\/(\d{2})\/(\d{4})$/.test(str(value))?str(value).replace(/^(\d{2})\/(\d{2})\/(\d{4})$/,'$3-$2-$1'):null;
// The technical layouts give date/time without an offset. Preserve the original wall clock,
// rather than silently assigning UTC or an undocumented timezone.
export function generatedAt(raw,dateKey='dg',timeKey='hg') {
 const date=dateOnly(raw?.[dateKey]),time=str(raw?.[timeKey]);
 return date&&/^\d{2}:\d{2}:\d{2}$/.test(time)?`${date}T${time}`:null;
}
export const phase = raw => raw?.f==='o'?'official':raw?.f==='s'?'simulation':'unknown';
export function normalizeConfig(raw) {
 const elections=[];
 for(const pl of list(raw?.pl))for(const e of list(pl.e)) {
  const offices=new Map();
  for(const abr of list(e.abr))for(const cp of list(abr.cp)) {
   const known=officeById(cp.cd);if(known)offices.set(known.id,{...known,name:str(cp.ds)||known.name,type:str(cp.tp)==='2'?'proportional':'majority'});
  }
  if(!offices.size||!/^ele\d{4}$/.test(str(pl.c))||!/^\d{1,6}$/.test(str(e.cd)))continue;
  const national=list(e.abr).some(x=>str(x.cd).toLowerCase()==='br');
  const ufs=national?['br',...STATES.map(x=>x.uf)]:list(e.abr).map(x=>str(x.cd).toLowerCase()).filter(Boolean);
  elections.push({id:str(e.cd),cycle:str(pl.c),turn:Number(e.t),name:str(e.nm),date:dateOnly(pl.dt)||'',offices:[...offices.values()],ufs});
 }
 return elections;
}
function elected(c) {
 const status=str(c.st).toLocaleLowerCase('pt-BR');
 if(/^eleit[oa](?:\s|$)/.test(status))return true;
 if(status&&(status.includes('turno')||status==='suplente'||status.startsWith('não eleit')))return false;
 // e=s alone is ambiguous: elected or advanced to the second round.
 return null;
}
export function normalizeResult(raw,query,election,municipalityName) {
 const carg=list(raw?.carg).find(c=>String(Number(c.cd))===query.office);
 if(!carg||str(raw.ele)!==election.id||Number(raw.t)!==query.turn) throw new Error('Arquivo EA20 não corresponde à eleição/cargo solicitado.');
 const expectedScope=query.municipality?'mu':query.uf==='br'?'br':'uf';
 if(str(raw.tpabr)!==expectedScope||str(raw.cdabr).toLowerCase()!==(query.municipality||query.uf))throw new Error('Abrangência do EA20 não corresponde à consulta.');
 const hidden=query.office==='1'&&raw.dv==='n';
 const candidates=[],parties=[];
 for(const agr of list(carg.agr))for(const par of list(agr.par)) {
  const nominal=number(par.tvtn),legend=number(par.tvtl);
  const votes=nominal===null?null:election.offices.find(x=>x.id===query.office)?.type==='proportional'?(legend===null?null:nominal+legend):nominal;
  const valid=number(raw.v?.vv);
  parties.push({id:str(par.n),name:str(par.sg)||str(par.nm),votes:hidden?null:votes,percent:hidden||votes===null||!valid?null:votes/valid*100,seats:agr.tp==='i'?number(agr.vag):null});
  for(const c of list(par.cand)) candidates.push({
   id:str(c.sqcand)||`${par.n}:${c.n}`,name:str(c.nmu)||str(c.nm),number:str(c.n),party:str(par.sg),partyNumber:str(par.n),coalition:str(agr.nm)||str(agr.com),
   votes:hidden?null:number(c.vap),percent:hidden?null:pct(c,'pvap'),status:str(c.st)||'Aguardando definição',elected:elected(c),destination:str(c.dvt)||undefined,
   runningMate:list(c.vs).map(v=>str(v.nmu)||str(v.nm)).filter(Boolean).join(' / ')||undefined,
   ...(/^\d{1,20}$/.test(str(c.sqcand))?{sequence:str(c.sqcand),...(raw.f==='o'?{photoUrl:photoLocalUrl({...query,electionId:election.id},str(c.sqcand)),photoSource:{provider:'TSE',url:photoUpstream({...query,electionId:election.id},str(c.sqcand))}}:{})}:{})
  });
 }
 const s=raw.s||{},e=raw.e||{},v=raw.v||{};
 const summary={sectionsTotal:number(s.ts),sectionsCounted:number(s.st),sectionsPending:number(s.snt),sectionsPercent:pct(s,'pst'),sectionsInstalled:number(s.si),sectionsNotInstalled:number(s.sni),sectionsTallied:number(s.sa),sectionsNotTallied:number(s.sna),electorate:number(e.te),electorateInstalled:number(e.esi),electorateCounted:number(e.est),turnout:number(e.c),turnoutPercent:pct(e,'pc'),abstention:number(e.a),abstentionPercent:pct(e,'pa'),
  votesTotal:hidden?null:number(v.tv),votesValid:hidden?null:number(v.vv),votesBlank:hidden?null:number(v.vb),votesNull:hidden?null:number(v.tvn),votesSubJudice:hidden?null:number(v.vansj),votesNominal:hidden?null:number(v.vnom),votesPartyList:hidden?null:number(v.vl),votesComputed:hidden?null:number(v.vvc),votesAnnulled:hidden?null:number(v.van),votesNullRegular:hidden?null:number(v.vn),votesNullTechnical:hidden?null:number(v.vnt),votesWithoutCandidate:hidden?null:number(v.vscv),finished:raw.and==='f',officialStatus:raw.and==='f'?'Totalização finalizada':raw.and==='p'?'Totalização em andamento':raw.and==='n'?'Aguardando início da totalização':'Andamento desconhecido',defined:raw.md==='e'||raw.md==='s',votesDisclosed:!hidden};
 if(raw.esae==='s')summary.officialStatus+=' · Sem atribuição de eleitos';
 return {scope:{uf:query.uf,...(query.municipality?{municipality:query.municipality}:{}),name:municipalityName||scopeName(query.uf)},election,office:{...election.offices.find(x=>x.id===query.office),seats:number(carg.nv)},candidates,parties,summary};
}
export function normalizeMunicipalities(raw,uf) {
 return list(raw?.abr).filter(x=>str(x.cd).toLowerCase()===uf).flatMap(abr=>list(abr.mu).filter(m=>/^\d{1,5}$/.test(str(m.cd))).map(m=>({id:str(m.cd).padStart(5,'0'),name:str(m.nm),uf,ibge:str(m.cdi)||undefined})));
}
export function normalizeRegions(raw,query,municipalities=[]) {
 const names=new Map(municipalities.map(m=>[m.id,m.name]));
 return list(raw?.abr).filter(a=>query.uf==='br'?a.tpabr==='uf':a.tpabr==='mun'||a.tpabr==='mu').map(a=>{
  const municipal=query.uf!=='br',code=str(a.cdabr).toLowerCase(),uf=municipal?query.uf:code;
  return {uf,name:municipal?(names.get(code)||`Município TSE ${code}`):scopeName(uf),region:STATES.find(s=>s.uf===uf)?.region,...(municipal?{municipality:code}:{}),sectionsPercent:pct(a.s,'pst'),sectionsCounted:number(a.s?.st),sectionsTotal:number(a.s?.ts),finished:a.and==='f',generatedAt:generatedAt(a,'dt','ht')};
 });
}
