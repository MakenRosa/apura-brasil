import test from 'node:test';
import assert from 'node:assert/strict';
import { studioHistory,studioOfficialTimeline,scheduledDateLabel } from '../src/lib/studio-history.ts';
const query={cycle:'ele2026',turn:1,office:'1',uf:'br',electionId:'100'};
const point=(id,extra={})=>({id,observedAt:`2026-10-04T15:00:${id.padStart(2,'0')}Z`,generatedAt:null,sectionsPercent:null,phase:'official',candidates:[],...extra});
const result=(history,extra={})=>({query,source:{},history,...extra});
test('scheduled second round never displays first-round history',()=>{
 assert.deepEqual(studioHistory(result([point('1')]),{...query,turn:2}),[]);
 assert.deepEqual(studioOfficialTimeline(result([point('1')]),query,true),[]);
});
test('scope identity includes UF, municipality, region, cycle, office and election',()=>{
 for(const changes of [{uf:'sp'},{municipality:'71072'},{region:'Sul'},{cycle:'ele2024'},{office:'3'},{electionId:'200'}])assert.deepEqual(studioHistory(result([point('1')]),{...query,...changes}),[]);
});
test('feed preserves reported phases; timeline only uses explicitly official versions',()=>{
 const envelope=result([point('3',{phase:'simulation'}),point('1'),point('2',{phase:undefined}),point('1')]);
 assert.deepEqual(studioHistory(envelope,query).map(point=>point.id),['1','2','3']);
 assert.deepEqual(studioOfficialTimeline(envelope,query).map(point=>point.id),['1']);
});
test('regional timeline accepts only compatible complete sums',()=>{
 const aggregation={region:'Sul',states:['pr','rs','sc'],complete:true};
 const envelope=result([point('1',{aggregation}),point('2',{aggregation:{...aggregation,complete:false}}),point('3',{aggregation:{...aggregation,region:'Norte'}})],{query:{...query,region:'Sul'},source:{aggregation}});
 assert.deepEqual(studioOfficialTimeline(envelope,{...query,region:'Sul'}).map(point=>point.id),['1']);
});
test('official date is stable across timezone and invalid dates are not normalized',()=>{
 assert.equal(scheduledDateLabel('2026-10-25'),'25 de outubro');
 assert.equal(scheduledDateLabel('2026-02-31'),'Data no calendário oficial');
});
test('simulation and official versions may share an ID without masking the official version',()=>{
 const envelope=result([point('1',{phase:'simulation'}),point('1',{observedAt:'2026-10-04T15:01:00Z'})]);
 assert.equal(studioHistory(envelope,query).length,2);
 assert.equal(studioOfficialTimeline(envelope,query).length,1);
 assert.equal(studioOfficialTimeline(envelope,query)[0].phase,'official');
});
