import test from 'node:test';
import assert from 'node:assert/strict';
import { REGION_ABBREVIATIONS, regionalTopTwo, regionSelectorOption } from '../src/lib/region-selector.ts';

// Synthetic unit-test inputs only; these values are never loaded by the app.
const candidate = (number, votes) => ({ id: number, number, name: `Candidato ${number}`, votes, percent: 999 });
const result = (region = 'Nordeste') => ({
  source: { phase: 'official', state: 'live', checkedAt: '2026-10-04T22:00:00Z', aggregation: { complete: true } },
  data: { scope: { region }, office: { id: '1' }, summary: { votesComputed: 100, sectionsPercent: 45, votesDisclosed: true }, candidates: [candidate('22', 30), candidate('55', 10), candidate('13', 60)] },
});

test('seletor classifica pela soma regional e calcula percentuais sobre votos computados', () => {
  const response = result();
  const leaders = regionalTopTwo('Nordeste', response);
  assert.deepEqual(leaders.map(c => [c.number, c.percent]), [['13', 60], ['22', 30]]);
  assert.equal(regionSelectorOption('Nordeste', 99, response).label, 'NE · 45,00% | 1º 13: 60,00% | 2º 22: 30,00%');
  assert.deepEqual(response.data.candidates.map(c => c.number), ['22', '55', '13']);
});

test('ausências, fase incompatível, região diferente e zero votos não inventam uma liderança', () => {
  const changes = [
    response => { response.source.aggregation.complete = false; },
    response => { response.source.phase = 'simulation'; },
    response => { response.data.scope.region = 'Sul'; },
    response => { response.data.office.id = '3'; },
    response => { response.data.summary.votesDisclosed = false; },
    response => { response.data.summary.votesComputed = 0; },
    response => { response.data.candidates[0].votes = null; },
    response => { response.data.summary.votesComputed = 200; },
  ];
  for (const change of changes) {
    const response = result(); change(response);
    assert.deepEqual(regionalTopTwo('Nordeste', response), []);
  }
  assert.equal(regionSelectorOption('Norte', null).label, 'N · — | 1º — | 2º —');
  assert.equal(regionSelectorOption('Sul', 0, undefined, false).label, 'S · 0,00%');
  assert.equal(regionSelectorOption('Nordeste', 12, { ...result(), source: { ...result().source, state: 'stale' } }).label.endsWith(' · cache'), true);
});

test('regiões usam siglas e outras disputas não exibem números presidenciais', () => {
  assert.deepEqual(Object.values(REGION_ABBREVIATIONS), ['N', 'NE', 'CO', 'SE', 'S']);
  assert.equal(regionSelectorOption('Centro-Oeste', 50, undefined, false).label, 'CO · 50,00%');
  assert.ok(regionSelectorOption('Sudeste', 50, undefined, false).title.startsWith('Sudeste.'));
});
