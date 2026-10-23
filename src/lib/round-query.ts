import type { Bootstrap, Election, ResultQuery, ScheduledRound } from '../../shared/types';

export function scheduledRoundFor(bootstrap:Bootstrap|null,query:ResultQuery):ScheduledRound|undefined {
 return bootstrap?.scheduledRounds?.find(round=>round.cycle===query.cycle&&round.turn===query.turn);
}
export function publishedRoundElections(bootstrap:Bootstrap|null,query:ResultQuery):Election[] {
 if(!bootstrap||bootstrap.status.phase!=='official')return [];
 return bootstrap.elections.filter(election=>!election.fallback&&election.cycle===query.cycle&&election.turn===query.turn&&election.offices.some(office=>office.id===query.office));
}
export function waitingForRound(bootstrap:Bootstrap|null,query:ResultQuery):boolean {
 const planned=scheduledRoundFor(bootstrap,query);
 return (Boolean(planned)||(query.cycle==='ele2026'&&query.turn===2))&&!publishedRoundElections(bootstrap,query).length;
}
/** A scheduled date never acts as an election identifier or a list of eligible UFs. */
export function resolveScheduledQuery(bootstrap:Bootstrap|null,query:ResultQuery):ResultQuery|null {
 if(!scheduledRoundFor(bootstrap,query)&&!(query.cycle==='ele2026'&&query.turn===2))return null;
 const planned=scheduledRoundFor(bootstrap,query);
 const office=(planned?.officeIds||['1','3']).includes(query.office)?query.office:'1';
 const next={...query,office,uf:query.uf.toLowerCase()};
 const elections=publishedRoundElections(bootstrap,next);
 if(!elections.length)return {...next,electionId:undefined,municipality:undefined,region:next.uf==='br'?next.region:undefined};
 const validUFs=[...new Set(elections.flatMap(election=>election.ufs.map(uf=>uf.toLowerCase())))];
 const uf=next.uf==='br'?'br':validUFs.includes(next.uf)?next.uf:office==='1'?'br':validUFs.find(uf=>!['br','zz'].includes(uf))||'br';
 const election=elections.find(item=>item.ufs.some(code=>code.toLowerCase()===uf))||elections[0];
 const region=uf==='br'&&bootstrap?.states.some(state=>state.region===next.region&&validUFs.includes(state.uf.toLowerCase()))?next.region:undefined;
 return {...next,uf,region,electionId:election.id,municipality:uf===next.uf&&query.electionId===election.id?query.municipality:undefined};
}
