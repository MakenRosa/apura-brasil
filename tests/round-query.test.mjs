import test from 'node:test';
import assert from 'node:assert/strict';
import { waitingForRound, resolveScheduledQuery, publishedRoundElections } from '../src/lib/round-query.ts';
const base={status:{phase:'official'},states:[{uf:'sp',region:'Sudeste'},{uf:'ba',region:'Nordeste'}],scheduledRounds:[{cycle:'ele2026',turn:2,date:'2026-10-25',officeIds:['1','3'],state:'awaiting-config'}],elections:[{id:'first',cycle:'ele2026',turn:1,offices:[{id:'1'}],ufs:['br','sp','ba']}]};
const query={cycle:'ele2026',turn:2,office:'1',uf:'br',region:'Nordeste',electionId:'first',municipality:'old'};
test('scheduled second round does not reuse first-round identifiers or municipalities',()=>{
 assert.equal(waitingForRound(base,query),true);
 assert.deepEqual(resolveScheduledQuery(base,query),{...query,electionId:undefined,municipality:undefined});
 assert.equal(publishedRoundElections(base,query).length,0);
});
test('configuration of governor does not activate presidential results',()=>{
 const bootstrap={...base,scheduledRounds:[{...base.scheduledRounds[0],state:'available'}],elections:[...base.elections,{id:'governor-second',cycle:'ele2026',turn:2,offices:[{id:'3'}],ufs:['sp']}]};
 assert.equal(waitingForRound(bootstrap,query),true);
 assert.equal(waitingForRound(bootstrap,{...query,office:'3'}),false);
});
test('simulation, unknown phase and fallback entries never activate a scheduled round',()=>{
 const official={id:'second',cycle:'ele2026',turn:2,offices:[{id:'1'}],ufs:['br','sp','ba']};
 for(const phase of ['unknown','simulation'])assert.equal(waitingForRound({...base,status:{phase},elections:[official]},query),true);
 assert.equal(waitingForRound({...base,elections:[{...official,fallback:true}]},query),true);
});
test('publication binds real election ID and retains only officially available scope',()=>{
 const bootstrap={...base,elections:[...base.elections,{id:'actual-second',cycle:'ele2026',turn:2,offices:[{id:'1'}],ufs:['br','sp','ba']}]};
 assert.equal(waitingForRound(bootstrap,query),false);
 const resolved=resolveScheduledQuery(bootstrap,query);
 assert.equal(resolved.electionId,'actual-second');assert.equal(resolved.region,'Nordeste');assert.equal(resolved.municipality,undefined);
 const gov={...bootstrap,elections:[{id:'actual-governor',cycle:'ele2026',turn:2,offices:[{id:'3'}],ufs:['sp']}]};
 assert.equal(resolveScheduledQuery(gov,{...query,office:'3',uf:'ba',region:undefined}).uf,'sp');
 assert.equal(resolveScheduledQuery(bootstrap,{...query,turn:1}),null);
});
