import {createHash} from 'node:crypto';

const known=value=>typeof value==='number'&&Number.isFinite(value);
export function historyCandidates(data,limit) {
 return [...data.candidates].sort((a,b)=>(b.votes??-1)-(a.votes??-1)).slice(0,limit).map(c=>({id:c.id,votes:c.votes,percent:c.percent,number:c.number,name:c.name,...(c.destination!==undefined?{destination:c.destination}:{}),...(c.uf?{uf:c.uf}:{})}));
}
export function regionalHistoryKey(query,states) {
 return JSON.stringify([query.cycle,query.turn,query.office,query.electionId,query.region,query.uf,[...states].sort()]);
}
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
export function regionalHistoryPoint(query,data,source,samples,{now,limit}) {
 const a=source.aggregation;
 // Every point is one complete observation. Independent UF generations are never
 // reconstructed into earlier regional points or aligned to a fictitious timestamp.
 if(!data||source.phase!=='official'||!a?.complete||a.missing.length||data.summary.votesDisclosed!==true||!known(data.summary.votesComputed)||!known(data.summary.votesValid)||!data.candidates.length||data.candidates.some(c=>!known(c.votes)||(query.office==='1'&&!c.sequence))||samples.some(s=>!s.raw||s.source.phase!=='official'||s.source.state==='stale'||!s.source.generatedAt||(query.office==='1'&&s.raw.dv!=='s')))return null;
 const ordered=[...samples].sort((a,b)=>a.uf.localeCompare(b.uf));
 const generations=ordered.map(s=>({uf:s.uf,generationId:s.source.generationId,generatedAt:s.source.generatedAt}));
 const id=createHash('sha256').update(JSON.stringify(stable(ordered.map(s=>({uf:s.uf,raw:s.raw}))))).digest('hex');
 return {id,phase:'official',generatedAt:null,observedAt:new Date(now).toISOString(),sectionsPercent:data.summary.sectionsPercent,votesValid:data.summary.votesValid,votesComputed:data.summary.votesComputed,candidatesTruncated:data.candidates.length>limit,candidates:historyCandidates(data,limit),aggregation:{kind:'region',region:query.region,states:a.states,included:a.included,missing:[],complete:true,generatedAtMin:a.generatedAtMin,generatedAtMax:a.generatedAtMax,generations}};
}
export function olderRegionalPoint(point,last) {
 const previous=new Map((last?.aggregation?.generations||[]).map(g=>[g.uf,g.generatedAt]));
 return point.aggregation.generations.some(g=>previous.has(g.uf)&&g.generatedAt<previous.get(g.uf));
}
