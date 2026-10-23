import { useEffect, useMemo, useRef, useState } from 'react';
import type { RegionName, ResultEnvelope, ResultQuery } from '../../shared/types';
import { REGION_NAMES } from './regional-progress';
import { getJSON, peekJSON, params } from './ui';
import { studioQueryMatches } from './studio-history';

type RegionalResults = Partial<Record<RegionName, ResultEnvelope>>;
type Options = { enabled: boolean; interval: number; paused: boolean; hidden: boolean; refresh: number };

export function useRegionalResults(query: ResultQuery, { enabled, interval, paused, hidden, refresh }: Options): RegionalResults {
  const key = params({ ...query, uf: 'br', municipality: undefined, region: undefined });
  const [snapshot, setSnapshot] = useState<{ key: string; results: RegionalResults } | null>(null);
  const validatedRefresh=useRef(0);
  const known=useMemo(()=>{
    const results:RegionalResults={};if(!enabled)return results;
    for(const region of REGION_NAMES){const cached=peekJSON<ResultEnvelope>(`/api/results?${key}&region=${encodeURIComponent(region)}`,{allowStale:true});if(cached)results[region]=cached;}
    return results;
  },[enabled,key]);

  useEffect(() => {
    if (!enabled || hidden) return;
    const controller = new AbortController();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cached:RegionalResults={};
    for(const region of REGION_NAMES){const value=peekJSON<ResultEnvelope>(`/api/results?${key}&region=${encodeURIComponent(region)}`,{allowStale:true});if(value)cached[region]=value;}
    setSnapshot(current=>({key,results:{...cached,...(current?.key===key?current.results:{})}}));
    const run = async () => {
      await Promise.allSettled(REGION_NAMES.map(async region => {
        try {
          const result = await getJSON<ResultEnvelope>(`/api/results?${key}&region=${encodeURIComponent(region)}`, controller.signal,{revalidate:refresh>validatedRefresh.current});
          if (cancelled || !studioQueryMatches(result.query,{...query,uf:'br',municipality:undefined,region})) return;
          setSnapshot(current => ({ key, results: { ...(current?.key === key ? current.results : {}), [region]: result } }));
        } catch {
          if (cancelled) return;
          setSnapshot(current => {
            if (current?.key !== key) return current;
            const results = { ...current.results };
            const last=peekJSON<ResultEnvelope>(`/api/results?${key}&region=${encodeURIComponent(region)}`,{allowStale:true,markStale:true});
            if(last)results[region]=last;else delete results[region];
            return { key, results };
          });
        }
      }));
      if(!cancelled)validatedRefresh.current=refresh;
      if (!cancelled && !paused) timer = setTimeout(run, interval * 1000);
    };
    void run();
    return () => { cancelled = true; controller.abort(); if (timer) clearTimeout(timer); };
  }, [enabled, key, interval, paused, hidden, refresh]);

  return enabled ? snapshot?.key === key ? snapshot.results : known : {};
}
