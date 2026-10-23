import type { Candidate, ResultEnvelope, ResultQuery } from '../../shared/types.ts';
import { studioQueryMatches } from './studio-history.ts';

export type SectionVoteSegment = { kind: 'bolsonaro' | 'lula' | 'other' | 'counted' | 'pending' | 'unknown'; width: number };
export type SectionVoteShare = { kind: 'bolsonaro' | 'lula'; candidate: Candidate; percent: number };
export type SectionVoteDistribution = { sectionsPercent: number | null; pendingPercent: number | null; segments: SectionVoteSegment[]; shares: SectionVoteShare[]; otherPercent: number | null };
const safe = (value: number | null | undefined, maximum = Infinity): value is number => value != null && Number.isFinite(value) && value >= 0 && value <= maximum;
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** Vote shares subdivide the counted fraction; uncounted sections are never estimated. */
export function sectionVoteDistribution(query: ResultQuery, result: ResultEnvelope | null, fallbackSections?: number | null): SectionVoteDistribution {
 const matches = !!result && studioQueryMatches(result.query, query);
 const data = matches ? result.data : null;
 const scopeMatches = !!data && data.scope.uf === query.uf && (data.scope.region || '') === (query.region || '') && (data.scope.municipality || '') === (query.municipality || '');
 const complete = !query.region || result?.source.aggregation?.region === query.region && result.source.aggregation.complete === true;
 const usable = scopeMatches && complete && data.election.cycle === query.cycle && data.election.turn === query.turn && data.office.id === query.office && (!query.electionId || data.election.id === query.electionId);
 const official = usable && result?.source.phase === 'official';
 const publishedSections = official ? data.summary.sectionsPercent : null;
 const sectionsPercent = safe(publishedSections, 100) ? publishedSections : safe(fallbackSections, 100) ? fallbackSections : null;
 const pendingPercent = sectionsPercent == null ? null : 100 - sectionsPercent;
 const fallback: SectionVoteDistribution = { sectionsPercent, pendingPercent, shares: [], otherPercent: null, segments: sectionsPercent == null ? [{ kind: 'unknown', width: 100 }] : [{ kind: 'counted', width: sectionsPercent }, { kind: 'pending', width: pendingPercent! }] };
 if (!official || !data || sectionsPercent == null || sectionsPercent === 0 || query.office !== '1' || data.summary.votesDisclosed === false) return fallback;
 const denominator = data.summary.votesComputed;
 const records = data.candidates;
 if (!safe(denominator) || denominator === 0 || !records.length || records.some(candidate => !safe(candidate.votes) || !Number.isSafeInteger(candidate.votes))) return fallback;
 const sum = records.reduce((total, candidate) => total + candidate.votes!, 0);
 if (sum !== denominator) return fallback;
 const lula = records.filter(candidate => candidate.number === '13' && /\blula\b/.test(normalize(candidate.name)));
 const bolsonaro = records.filter(candidate => candidate.number === '22' && /\bbolsonaro\b/.test(normalize(candidate.name)));
 if (lula.length !== 1 || bolsonaro.length !== 1) return fallback;
 const shares: SectionVoteShare[] = [
  { kind: 'bolsonaro', candidate: bolsonaro[0], percent: 100 * bolsonaro[0].votes! / denominator },
  { kind: 'lula', candidate: lula[0], percent: 100 * lula[0].votes! / denominator },
 ];
 const otherPercent = 100 * (denominator - bolsonaro[0].votes! - lula[0].votes!) / denominator;
 return { sectionsPercent, pendingPercent, shares, otherPercent, segments: sectionsPercent == null ? fallback.segments : [
  ...shares.map(share => ({ kind: share.kind, width: sectionsPercent * share.percent / 100 })),
  { kind: 'other', width: sectionsPercent * otherPercent / 100 },
  { kind: 'pending', width: pendingPercent! },
 ] };
}
