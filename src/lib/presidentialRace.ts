import type { Candidate, HistoryPoint, ResultEnvelope, ResultQuery } from '../../shared/types.ts';

export type RaceMetric = 'percent' | 'votes';
export type RaceCandidate = { candidate:Candidate; color:string; key:'lula'|'bolsonaro' };
export type RaceValue = { votes:number|null; percent:number|null };
export type RaceSnapshot = { point:HistoryPoint; values:[RaceValue,RaceValue] };
export type PresidentialRace = { candidates:RaceCandidate[]; snapshots:RaceSnapshot[]; excluded:number; truncated:boolean; matches:boolean };
const normalize = (value:string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const safe = (value:number|null|undefined, maximum=Infinity) => value!=null && Number.isFinite(value) && value>=0 && value<=maximum ? value : null;

export function sameRaceQuery(actual:ResultQuery, expected:ResultQuery):boolean {
 return actual.cycle===expected.cycle && actual.turn===expected.turn && actual.office===expected.office && actual.uf===expected.uf && (actual.municipality||'')===(expected.municipality||'') && (actual.region||'')===(expected.region||'') && (!expected.electionId||actual.electionId===expected.electionId);
}

/** Candidate identity comes from this election's current record, never a historical sequence. */
export function buildPresidentialRace(result:ResultEnvelope|null, query:ResultQuery):PresidentialRace {
 const empty:PresidentialRace={candidates:[],snapshots:[],excluded:0,truncated:false,matches:false};
 if(!result || query.office!=='1' || !sameRaceQuery(result.query,query))return empty;
 const records=result.data?.candidates||[];
 const lula=records.find(candidate=>candidate.number==='13' && /\blula\b/.test(normalize(candidate.name)));
 const bolsonaro=records.find(candidate=>candidate.number==='22' && /\bbolsonaro\b/.test(normalize(candidate.name)));
 const candidates:RaceCandidate[]=[];
 if(lula)candidates.push({candidate:lula,color:'#d9474f',key:'lula'});
 if(bolsonaro)candidates.push({candidate:bolsonaro,color:'#347fd6',key:'bolsonaro'});
 if(!lula||!bolsonaro)return {...empty,candidates,matches:true};
 const seen=new Set<string>();
 let excluded=0,truncated=false;
 const snapshots:RaceSnapshot[]=[];
 for(const point of [...result.history].sort((a,b)=>a.observedAt.localeCompare(b.observedAt))){
  const expectedStates=result.source.aggregation?.states.map(uf=>uf.toLowerCase()).sort().join(',');
  const actualStates=point.aggregation?.states.map(uf=>uf.toLowerCase()).sort().join(',');
  const regionMatches=query.region ? point.aggregation?.region===query.region && point.aggregation.complete && (!expectedStates||actualStates===expectedStates) : !point.aggregation;
  if(point.phase!=='official' || !regionMatches || seen.has(point.id)){excluded++;continue;}
  seen.add(point.id);
  truncated ||= point.candidatesTruncated===true;
  // Legacy complete records can establish a positive denominator without changing TSE percentages.
  const completeLegacy=point.candidatesTruncated===false && point.candidates.length>0 && point.candidates.every(candidate=>safe(candidate.votes)!=null);
  const legacyTotal=completeLegacy?point.candidates.reduce((total,candidate)=>total+candidate.votes!,0):0;
  const countingStarted=point.votesComputed!=null ? safe(point.votesComputed)!==null && point.votesComputed>0 : legacyTotal>0;
  const values=[lula,bolsonaro].map(candidate=>{
   const recorded=point.candidates.find(item=>item.id===candidate.id);
   return {votes:safe(recorded?.votes),percent:countingStarted?safe(recorded?.percent,100):null};
  }) as [RaceValue,RaceValue];
  snapshots.push({point,values});
 }
 return {candidates,snapshots,excluded,truncated,matches:true};
}

/** Trim only empty edges; internal missing observations remain gaps in the curves. */
export function raceSeries(race:PresidentialRace, metric:RaceMetric):RaceSnapshot[] {
 const useful=(snapshot:RaceSnapshot)=>snapshot.values.some(value=>value[metric]!=null);
 const first=race.snapshots.findIndex(useful);
 if(first<0)return [];
 let last=race.snapshots.length-1;
 while(last>first&&!useful(race.snapshots[last]))last--;
 return race.snapshots.slice(first,last+1);
}

/** Exposed axis limits keep a close race readable without concealing the cropped scale. */
export function raceExtent(snapshots:RaceSnapshot[],metric:RaceMetric):{min:number;max:number} {
 const values=snapshots.flatMap(snapshot=>snapshot.values.map(value=>value[metric]).filter((value):value is number=>value!=null));
 if(!values.length)return {min:0,max:metric==='percent'?100:1};
 if(metric==='votes')return {min:0,max:Math.max(1,...values)*1.08};
 const low=Math.min(...values),high=Math.max(...values);
 const span=Math.max(8,(high-low)*1.3),center=(low+high)/2;
 const step=span<=20?2:span<=40?5:10;
 let min=Math.max(0,Math.floor((center-span/2)/step)*step);
 let max=Math.min(100,Math.ceil((center+span/2)/step)*step);
 if(max-min<8){if(min===0)max=8;else if(max===100)min=92;}
 return {min,max};
}

/** A change is marked at the observed version, without estimating an intermediate instant. */
export function observedLeadChanges(snapshots:RaceSnapshot[]):number[] {
 const changes:number[]=[];
 let previous:number|null=null;
 snapshots.forEach((snapshot,index)=>{
  const [a,b]=snapshot.values;
  if(a.votes==null||b.votes==null){previous=null;return;}
  const lead=Math.sign(a.votes-b.votes);
  if(lead===0){return;}
  if(previous!=null&&lead!==previous)changes.push(index);
  previous=lead;
 });
 return changes;
}
