import type { Candidate, RegionName, ResultEnvelope } from '../../shared/types';
import { percent, time } from './ui.ts';

export const REGION_ABBREVIATIONS: Record<RegionName, string> = {
  Norte: 'N', Nordeste: 'NE', 'Centro-Oeste': 'CO', Sudeste: 'SE', Sul: 'S',
};

export type RegionSelectorOption = { label: string; title: string };

export function regionalTopTwo(region: RegionName, result?: ResultEnvelope): Candidate[] {
  const data = result?.data;
  const total = data?.summary.votesComputed;
  if (!data || data.office.id !== '1' || data.scope.region !== region
    || result?.source.phase !== 'official' || !result.source.aggregation?.complete
    || data.summary.votesDisclosed === false || total == null || !Number.isFinite(total) || total <= 0
    || data.candidates.some(candidate => candidate.votes == null || !Number.isFinite(candidate.votes) || candidate.votes < 0)
    || data.candidates.reduce((sum, candidate) => sum + candidate.votes!, 0) !== total) return [];

  return [...data.candidates]
    .sort((a, b) => b.votes! - a.votes! || a.name.localeCompare(b.name, 'pt-BR'))
    .slice(0, 2)
    .filter(candidate => candidate.votes! > 0 && /^\d+$/.test(candidate.number))
    .map(candidate => ({ ...candidate, percent: 100 * candidate.votes! / total }));
}

export function regionSelectorOption(region: RegionName, progress: number | null, result?: ResultEnvelope, includeLeaders = true): RegionSelectorOption {
  const complete = result?.data?.scope.region === region && result.source.phase === 'official' && result.source.aggregation?.complete;
  const sections = complete ? result.data!.summary.sectionsPercent : progress;
  const leaders = regionalTopTwo(region, result);
  let label = `${REGION_ABBREVIATIONS[region]} · ${percent(sections)}`;
  let title = `${region}. Seções totalizadas: ${percent(sections)}.`;
  if (includeLeaders) {
    for (let index = 0; index < 2; index++) {
      const candidate = leaders[index];
      label += ` | ${index + 1}º ${candidate ? `${candidate.number}: ${percent(candidate.percent)}` : '—'}`;
      title += candidate ? ` ${index + 1}º: ${candidate.name}, número ${candidate.number}, ${percent(candidate.percent)} dos votos computados da região.` : ` ${index + 1}º: votação regional ainda indisponível.`;
    }
    if (leaders.length === 2 && leaders[0].votes === leaders[1].votes) title += ' Empate em votos; ordem alfabética dos nomes.';
  }
  if (result?.source.phase === 'simulation') label += ' · simulação';
  if (result?.source.state === 'stale') label += ' · cache';
  if (result) title += ` Verificado em Brasília às ${time(result.source.checkedAt)}. ${result.source.message || ''}`;
  return { label, title };
}
