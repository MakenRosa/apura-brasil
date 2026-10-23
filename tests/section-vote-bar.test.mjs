import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionVoteDistribution } from '../src/lib/section-vote-bar.ts';

// Synthetic arithmetic fixtures are never served to the application.
const query = { cycle: 'ele2026', turn: 1, office: '1', uf: 'br', electionId: 'example' };
const candidate = (number, name, votes) => ({ id: number, number, name, votes, percent: 999 });
function fixture() { return { query: { ...query }, source: { phase: 'official' }, data: { scope: { uf: 'br' }, office: { id: '1' }, election: { cycle: 'ele2026', turn: 1, id: 'example' }, summary: { sectionsPercent: 40, votesComputed: 100, votesDisclosed: true }, candidates: [candidate('13', 'LULA', 50), candidate('22', 'FLÁVIO BOLSONARO', 35), candidate('55', 'Outra candidatura', 15)] } }; }

test('pending sections and vote shares retain separate denominators and cover the whole bar', () => {
 const distribution = sectionVoteDistribution(query, fixture());
 assert.deepEqual(distribution.segments, [{ kind: 'bolsonaro', width: 14 }, { kind: 'lula', width: 20 }, { kind: 'other', width: 6 }, { kind: 'pending', width: 60 }]);
 assert.deepEqual(distribution.shares.map(share => [share.candidate.number, share.percent]), [['22', 35], ['13', 50]]);
 assert.equal(distribution.otherPercent, 15);
 assert.equal(distribution.segments.reduce((sum, segment) => sum + segment.width, 0), 100);
});
test('complete totalization leaves no pending or fabricated other-candidate band', () => {
 const response = fixture(); response.data.summary.sectionsPercent = 100; response.data.candidates.pop(); response.data.summary.votesComputed = 85;
 const distribution = sectionVoteDistribution(query, response);
 assert.equal(distribution.pendingPercent, 0); assert.equal(distribution.otherPercent, 0);
 assert.ok(Math.abs(distribution.segments.reduce((sum, segment) => sum + segment.width, 0) - 100) < 1e-10);
});
test('missing data is distinct from a published zero; no vote projections before counting', () => {
 assert.deepEqual(sectionVoteDistribution(query, null).segments, [{ kind: 'unknown', width: 100 }]);
 const response = fixture(); response.data.summary.sectionsPercent = 0; response.data.summary.votesComputed = 0; response.data.candidates.forEach(candidate => candidate.votes = 0);
 const distribution = sectionVoteDistribution(query, response);
 assert.deepEqual(distribution.segments, [{ kind: 'counted', width: 0 }, { kind: 'pending', width: 100 }]); assert.deepEqual(distribution.shares, []);
});
test('simulation, incomplete votes, inconsistent sums or a different identity never become official voting colors', () => {
 for (const change of [response => response.source.phase = 'simulation', response => response.data.summary.votesDisclosed = false, response => response.data.candidates[0].votes = null, response => response.data.summary.votesComputed = 120, response => response.data.candidates[1].name = 'Outra pessoa', response => response.data.election.turn = 2, response => response.data.office.id = '3']) {
  const response = fixture(); change(response); assert.deepEqual(sectionVoteDistribution(query, response, 40).shares, []);
 }
});
test('a delayed response from another region, municipality, election, office or turn cannot color the new selection', () => {
 for (const change of [q => q.region = 'Sul', q => q.uf = 'sp', q => q.municipality = '123', q => q.electionId = 'different', q => q.office = '3', q => q.turn = 2, q => q.cycle = 'ele2022']) {
  const next = { ...query }; change(next); const distribution = sectionVoteDistribution(next, fixture()); assert.deepEqual(distribution.shares, []); assert.equal(distribution.sectionsPercent, null);
 }
});
test('regional bars require the complete regional sum and use its corresponding section progress', () => {
 const regionalQuery = { ...query, region: 'Nordeste' }; const response = fixture(); response.query = regionalQuery; response.data.scope.region = 'Nordeste'; response.source.aggregation = { region: 'Nordeste', complete: true };
 assert.equal(sectionVoteDistribution(regionalQuery, response, 70).sectionsPercent, 40);
 assert.equal(sectionVoteDistribution(regionalQuery, response).shares.length, 2);
 response.source.aggregation.complete = false;
 const distribution = sectionVoteDistribution(regionalQuery, response, 70); assert.deepEqual(distribution.shares, []); assert.equal(distribution.sectionsPercent, 70);
});
test('the second round uses its own official records; unavailable section progress does not imply counted votes', () => {
 const next = { ...query, turn: 2 }; const response = fixture(); response.query = next; response.data.election.turn = 2;
 assert.equal(sectionVoteDistribution(next, response).shares.length, 2);
 for (const sectionsPercent of [null, 0, -1, 101]) {
  response.data.summary.sectionsPercent = sectionsPercent;
  assert.deepEqual(sectionVoteDistribution(next, response).shares, []);
 }
});
