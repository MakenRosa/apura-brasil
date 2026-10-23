import type { HistoryPoint, ResultEnvelope, ResultQuery } from '../../shared/types.ts';

export function studioQueryMatches(a:ResultQuery,b:ResultQuery):boolean {
 return a.cycle===b.cycle && a.turn===b.turn && a.office===b.office && a.uf===b.uf && (a.region||'')===(b.region||'') && (a.municipality||'')===(b.municipality||'') && (!b.electionId||a.electionId===b.electionId);
}

/** Neutral metadata only; no candidate fields are read by the studio. */
export function studioHistory(result:ResultEnvelope|null,query:ResultQuery,waiting=false):HistoryPoint[] {
 if(waiting||!result||!studioQueryMatches(result.query,query))return [];
 const seen=new Set<string>();
 return [...result.history].sort((a,b)=>a.observedAt.localeCompare(b.observedAt)).filter(point=>{
  const identity=`${point.phase||'unknown'}:${point.id}`;
  if(seen.has(identity))return false;
  seen.add(identity);
  return query.region ? point.aggregation?.region===query.region : !point.aggregation;
 });
}

export function studioOfficialTimeline(result:ResultEnvelope|null,query:ResultQuery,waiting=false):HistoryPoint[] {
 const expected=result?.source.aggregation?.states.map(uf=>uf.toLowerCase()).sort().join(',');
 return studioHistory(result,query,waiting).filter(point=>point.phase==='official' && (!query.region || point.aggregation?.complete===true && (!expected||point.aggregation.states.map(uf=>uf.toLowerCase()).sort().join(',')===expected)));
}

export function scheduledDateLabel(date?:string):string {
 if(!date||!/^\d{4}-\d{2}-\d{2}$/.test(date))return 'Data no calendário oficial';
 const [year,month,day]=date.split('-').map(Number);
 const parsed=new Date(Date.UTC(year,month-1,day));
 if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day)return 'Data no calendário oficial';
 return parsed.toLocaleDateString('pt-BR',{timeZone:'UTC',day:'numeric',month:'long'});
}
