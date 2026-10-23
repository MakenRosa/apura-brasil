import type { RegionName, RegionRow, State } from '../../shared/types';

export const REGION_NAMES: RegionName[] = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul'];

export function regionalProgress(rows: RegionRow[], eligibleStates: State[]): Record<RegionName, number | null> {
  const byUF = new Map<string, RegionRow[]>();
  for (const row of rows) {
    if (row.municipality) continue;
    const uf = row.uf.toLowerCase();
    byUF.set(uf, [...(byUF.get(uf) || []), row]);
  }

  const progress = {} as Record<RegionName, number | null>;
  for (const region of REGION_NAMES) {
    const members = eligibleStates.filter(state => state.region === region);
    let counted = 0;
    let total = 0;
    let complete = members.length > 0;
    for (const state of members) {
      const matches = byUF.get(state.uf.toLowerCase()) || [];
      const row = matches[0];
      if (matches.length !== 1 || row.sectionsCounted == null || row.sectionsTotal == null
        || !Number.isFinite(row.sectionsCounted) || !Number.isFinite(row.sectionsTotal)
        || row.sectionsCounted < 0 || row.sectionsTotal < 0 || row.sectionsCounted > row.sectionsTotal) {
        complete = false;
        break;
      }
      counted += row.sectionsCounted;
      total += row.sectionsTotal;
    }
    progress[region] = complete && total > 0 ? 100 * counted / total : null;
  }
  return progress;
}
