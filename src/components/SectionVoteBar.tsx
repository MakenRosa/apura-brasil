import type { SectionVoteDistribution } from '../lib/section-vote-bar';
import { number, percent } from '../lib/ui';
import './SectionVoteBar.css';

export function SectionVoteBar({ distribution, compact = false }: { distribution: SectionVoteDistribution; compact?: boolean }) {
 const { sectionsPercent, pendingPercent, segments, shares, otherPercent } = distribution;
 const description = sectionsPercent == null ? 'Percentual de seções totalizadas indisponível.' : `${percent(sectionsPercent)} das seções totalizadas; ${percent(pendingPercent)} das seções pendentes.`;
 const voting = shares.length ? ` ${shares.map(share => `${share.candidate.name}, número ${share.candidate.number}: ${percent(share.percent)} dos votos computados`).join('; ')}.${otherPercent! > 0 ? ` Outras candidaturas: ${percent(otherPercent)}.` : ''} As cores dividem apenas o trecho totalizado, proporcionalmente à votação publicada; não estimam votos pendentes.` : ' A votação ainda não está disponível para dividir o trecho totalizado.';
 return <span className={`section-vote-bar${compact ? ' section-vote-bar-compact' : ''}`}>
  <span className="section-vote-track" role="img" aria-label={description + voting} title={description + voting}>
   {segments.filter(segment => segment.width > 0).map(segment => <i key={segment.kind} className={`section-vote-segment section-vote-${segment.kind}`} style={{ width: `${segment.width}%` }} />)}
  </span>
  {shares.length > 0 && <span className="section-vote-labels"><span className="section-vote-caption">Votos</span>{shares.map(share => <span key={share.kind} className={`section-vote-share section-vote-share-${share.kind}`} title={`${share.candidate.name} · ${number(share.candidate.votes)} votos · % sobre votos computados`}><i aria-hidden="true"/><b>{share.candidate.number}</b> {percent(share.percent)}</span>)}{otherPercent! > 0 && <span className="section-vote-other-label" title="Percentual dos votos computados para outras candidaturas"><i aria-hidden="true"/>Outros {percent(otherPercent)}</span>}</span>}
 </span>;
}
