import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPresidentialRace, raceSeries, raceExtent, observedLeadChanges } from '../src/lib/presidentialRace.ts';

const query={cycle:'ele2026',turn:1,office:'1',uf:'br',electionId:'900'};
const candidates=[{id:'current-13',name:'LULA',number:'13'},{id:'current-22',name:'FLÁVIO BOLSONARO',number:'22'}];
const point=(id,a,b,extra={})=>({id,generatedAt:null,observedAt:`2026-10-04T15:00:${id.padStart(2,'0')}Z`,sectionsPercent:25,phase:'official',candidatesTruncated:false,candidates:[{id:'current-13',votes:a,percent:a==null?null:a},{id:'current-22',votes:b,percent:b==null?null:b}],...extra});
const envelope=(history,extra={})=>({query,data:{candidates},source:{phase:'official'},history,...extra});

test('identifies this election by name and number, using its stable IDs',()=>{
 const race=buildPresidentialRace(envelope([point('1',60,40)]),query);
 assert.equal(race.candidates[1].candidate.name,'FLÁVIO BOLSONARO');
 assert.deepEqual(race.snapshots[0].values,[{votes:60,percent:60},{votes:40,percent:40}]);
 assert.equal(buildPresidentialRace(envelope([],{data:{candidates:[{id:'13',name:'OTHER',number:'13'},candidates[1]]}}),query).snapshots.length,0);
});
test('rejects stale envelopes from another scope, turn, election or region',()=>{
 for(const mismatch of [{uf:'sp'},{municipality:'71072'},{turn:2},{electionId:'901'},{region:'Sul'}])assert.equal(buildPresidentialRace(envelope([point('1',60,40)],{query:{...query,...mismatch}}),query).matches,false);
});
test('zero before counting is not plotted as zero percent; recorded zero votes remain honest',()=>{
 const race=buildPresidentialRace(envelope([point('1',0,0),point('2',60,40)]),query);
 assert.equal(race.snapshots[0].values[0].percent,null);
 assert.equal(raceSeries(race,'percent').length,1);
 assert.equal(raceSeries(race,'votes').length,2);
});
test('official unknown/simulation are excluded; null and missing remain gaps',()=>{
 const race=buildPresidentialRace(envelope([point('1',60,40),point('2',null,null),point('3',40,60),point('4',40,60,{phase:'simulation'}),point('5',40,60,{phase:undefined})]),query);
 assert.equal(race.excluded,2);
 assert.equal(raceSeries(race,'percent').length,3);
 assert.deepEqual(race.snapshots[1].values,[{votes:null,percent:null},{votes:null,percent:null}]);
 assert.deepEqual(observedLeadChanges(race.snapshots),[]);
});
test('a lead change is recorded only at a new official observed version',()=>{
 assert.deepEqual(observedLeadChanges(buildPresidentialRace(envelope([point('1',60,40),point('2',50,50),point('3',40,60)]),query).snapshots),[2]);
});
test('regional history never mixes different or incomplete sums with the selected region',()=>{
 const aggregation={region:'Sul',complete:true,states:['pr','rs','sc']};
 const race=buildPresidentialRace(envelope([point('1',60,40,{aggregation}),point('2',40,60,{aggregation:{...aggregation,complete:false}}),point('3',40,60,{aggregation:{...aggregation,region:'Norte'}}),point('4',40,60)],{query:{...query,region:'Sul'}}),{...query,region:'Sul'});
 assert.equal(race.snapshots.length,1);
 assert.equal(race.excluded,3);
});
test('truncated records never fill an omitted candidacy with zero or match another ID',()=>{
 const race=buildPresidentialRace(envelope([point('1',60,40,{candidatesTruncated:true,candidates:[{id:'current-13',votes:10,percent:60},{id:'old-22',votes:20,percent:40}]})]),query);
 assert.equal(race.truncated,true);
 assert.equal(race.snapshots[0].values[1].votes,null);
});
test('invalid numerical values are unavailable',()=>{
 const race=buildPresidentialRace(envelope([point('1',NaN,-1,{votesComputed:100,candidates:[{id:'current-13',votes:NaN,percent:105},{id:'current-22',votes:-1,percent:Infinity}]})]),query);
 assert.deepEqual(race.snapshots[0].values,[{votes:null,percent:null},{votes:null,percent:null}]);
});
test('the automatic percent axis exposes a readable bounded range including all observed values',()=>{
 for(const [a,b] of [[40.66,51.23],[50,50],[0,1],[99,100],[0,100]]){
  const snapshots=buildPresidentialRace(envelope([point('1',a,b,{votesComputed:100})]),query).snapshots;
  const extent=raceExtent(snapshots,'percent');
  assert.ok(extent.min>=0&&extent.max<=100);
  assert.ok(extent.min<=Math.min(a,b)&&extent.max>=Math.max(a,b));
  assert.ok(extent.max-extent.min>=8);
  if(a===40.66)assert.ok(extent.max-extent.min<30);
 }
});
test('legacy percentages without a confirmed complete denominator stay unavailable',()=>{
 const race=buildPresidentialRace(envelope([point('1',60,40,{candidatesTruncated:undefined}),point('2',60,null)]),query);
 assert.equal(raceSeries(race,'percent').length,0);
 assert.equal(raceSeries(race,'votes').length,2);
});
