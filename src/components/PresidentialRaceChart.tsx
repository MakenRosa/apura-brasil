import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Activity, ArrowLeftRight, Clock3, Info } from 'lucide-react';
import type { ResultEnvelope, ResultQuery } from '../../shared/types';
import { dateTime, number, percent, time } from '../lib/ui';
import { buildPresidentialRace, observedLeadChanges, raceExtent, raceSeries, type RaceMetric, type RaceSnapshot } from '../lib/presidentialRace';
import { CandidatePortrait } from './CandidatePortrait';
import './PresidentialRaceChart.css';

export type PresidentialRaceChartProps = { result:ResultEnvelope|null; query:ResultQuery; scopeName:string };
const HEIGHT=238, TOP=16, BOTTOM=218;
const shortNumber=(value:number)=>new Intl.NumberFormat('pt-BR',{notation:'compact',maximumFractionDigits:1}).format(value);
const formatValue=(value:number|null|undefined,metric:RaceMetric)=>metric==='percent'?percent(value):number(value);

export function PresidentialRaceChart({result,query,scopeName}:PresidentialRaceChartProps){
 const [metric,setMetric]=useState<RaceMetric>('percent');
 const [selectedId,setSelectedId]=useState('');
 const [width,setWidth]=useState(760);
 const svgRef=useRef<SVGSVGElement>(null);
 const pointRefs=useRef<(SVGRectElement|null)[]>([]);
 const race=useMemo(()=>buildPresidentialRace(result,query),[result,query]);
 const snapshots=useMemo(()=>raceSeries(race,metric),[race,metric]);
 const changes=useMemo(()=>observedLeadChanges(snapshots),[snapshots]);
 const activeIndex=Math.max(0,snapshots.findIndex(snapshot=>snapshot.point.id===selectedId)>=0?snapshots.findIndex(snapshot=>snapshot.point.id===selectedId):snapshots.length-1);
 const active=snapshots[activeIndex];
 const extent=useMemo(()=>raceExtent(snapshots,metric),[snapshots,metric]);
 const {min:minimum,max:maximum}=extent;
 const x=(index:number)=>snapshots.length===1?width/2:20+index/(snapshots.length-1)*(width-40);
 const y=(value:number)=>BOTTOM-(value-minimum)/(maximum-minimum)*(BOTTOM-TOP);
 const valueText=(snapshot:RaceSnapshot)=>race.candidates.map((candidate,index)=>`${candidate.candidate.name}: ${percent(snapshot.values[index].percent)}, ${number(snapshot.values[index].votes)} votos`).join('; ');
 const tooltipLabel=(snapshot:RaceSnapshot,index:number)=>`Parcial ${index+1}, observada ${dateTime(snapshot.point.observedAt)}. ${valueText(snapshot)}. Seções totalizadas: ${percent(snapshot.point.sectionsPercent)}`;
 const path=(candidateIndex:number)=>{
  let connected=false;
  return snapshots.map((snapshot,index)=>{
   const value=snapshot.values[candidateIndex][metric];
   if(value==null){connected=false;return '';}
   const command=connected?'L':'M';connected=true;
   return `${command}${x(index)},${y(value)}`;
  }).join(' ');
 };
 useEffect(()=>{
  const svg=svgRef.current;if(!svg)return;
  const observer=new ResizeObserver(entries=>setWidth(Math.max(200,entries[0].contentRect.width)));
  observer.observe(svg);return()=>observer.disconnect();
 },[snapshots.length>0]);
 function selectPoint(index:number,focus=false){const next=Math.max(0,Math.min(snapshots.length-1,index));setSelectedId(snapshots[next].point.id);if(focus)pointRefs.current[next]?.focus();}
 function keyboard(event:KeyboardEvent<SVGRectElement>,index:number){
  const next=event.key==='ArrowRight'?index+1:event.key==='ArrowLeft'?index-1:event.key==='Home'?0:event.key==='End'?snapshots.length-1:null;
  if(next!=null){event.preventDefault();selectPoint(next,true);}
  if(event.key==='Enter'||event.key===' '){event.preventDefault();selectPoint(index);}
 }
 const status=race.matches?result?.source:null;
 const scope=query.municipality?`${scopeName} / ${query.uf.toUpperCase()} · Município`:query.region||scopeName;
 const waitingMessage=!race.matches?'Aguardando os dados do recorte selecionado.':race.candidates.length<2?'As duas candidaturas ainda não estão identificadas no registro oficial deste pleito.':metric==='percent'&&race.snapshots.length?'Os percentuais aparecerão quando uma parcial oficial tiver votos computados e denominador disponível.':'O histórico começa com a primeira parcial oficial coletada nesta instalação.';
 const last=snapshots.at(-1);
 return <section className="race-chart" aria-labelledby="race-chart-title">
  <header className="race-chart-header"><div><span className="race-chart-kicker"><Activity size={13}/>PARCIAIS DA PRESIDÊNCIA</span><h2 id="race-chart-title">A evolução dos votos</h2><p>{scope} <span>·</span> {query.cycle.replace(/^ele/,'')} <span>·</span> {query.turn}º turno</p></div><div className="race-chart-controls"><span>{number(snapshots.length)} {snapshots.length===1?'parcial':'parciais'}</span><div role="group" aria-label="Métrica do gráfico"><button aria-pressed={metric==='percent'} onClick={()=>setMetric('percent')}>Porcentagem</button><button aria-pressed={metric==='votes'} onClick={()=>setMetric('votes')}>Votos</button></div></div></header>
  <div className="race-chart-candidates">{race.candidates.map((candidate,index)=><div key={candidate.key} className={`race-chart-candidate race-chart-${candidate.key}`} style={{'--race-color':candidate.color} as React.CSSProperties}><CandidatePortrait candidate={candidate.candidate} size="small" decorative/><div className="race-chart-candidate-name"><strong>{candidate.candidate.name}</strong><span><i/>{candidate.candidate.party||'Partido não informado'} · {candidate.candidate.number}</span></div><div className="race-chart-candidate-value"><strong>{percent((active||last)?.values[index]?.percent)}</strong><span>{number((active||last)?.values[index]?.votes)} votos</span></div></div>)}</div>
  {status?.phase==='simulation'&&<p className="race-chart-warning"><Info size={13}/>A consulta atual é uma simulação do TSE. O gráfico aceita somente versões oficiais anteriores, se existentes.</p>}
  {status?.state==='stale'&&<p className="race-chart-warning"><Clock3 size={13}/>Últimos registros em cache; a fonte está desatualizada.</p>}
  {snapshots.length>0?<>
   <div className="race-chart-axis-name">{metric==='percent'?'% dos votos computados':'Votos registrados nas parciais'}{metric==='percent'&&<span>Escala automática: {minimum}% a {maximum}%</span>}</div>
   <div className="race-chart-plot"><div className="race-chart-y-axis" aria-hidden="true">{[1,.75,.5,.25,0].map(fraction=>{const value=minimum+(maximum-minimum)*fraction;return <span key={fraction} style={{top:`${(1-fraction)*100}%`}}>{metric==='percent'?`${value.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`:shortNumber(value)}</span>;})}</div><div className="race-chart-svg-wrap"><svg ref={svgRef} viewBox={`0 0 ${width} ${HEIGHT}`} preserveAspectRatio="none" role="group" aria-label={`Evolução de ${metric==='percent'?`percentuais dos votos computados, escala de ${minimum}% a ${maximum}%`:'votos'} em ${snapshots.length} parciais oficiais. Use as setas para explorar.`}>
    <title>Parciais oficiais observadas · {scope}</title><desc>O espaço entre parciais é uniforme. Lacunas indicam valores ausentes, e linhas conectam somente observações consecutivas disponíveis. A comparação não declara eleição.</desc>
    {[0,.25,.5,.75,1].map(fraction=><line className="race-chart-grid" key={fraction} x1="0" x2={width} y1={y(minimum+(maximum-minimum)*fraction)} y2={y(minimum+(maximum-minimum)*fraction)}/>)}
    {active&&<line className="race-chart-guide" x1={x(activeIndex)} x2={x(activeIndex)} y1={TOP} y2={BOTTOM}/>}
    {changes.map(index=><line className="race-chart-change" key={index} x1={x(index)} x2={x(index)} y1={TOP} y2={BOTTOM}><title>Mudança na posição relativa entre as candidaturas observada nesta parcial.</title></line>)}
    {race.candidates.map((candidate,candidateIndex)=><g key={candidate.key}><path d={path(candidateIndex)} fill="none" stroke={candidate.color} strokeWidth="3" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round"/>{snapshots.map((snapshot,index)=>snapshot.values[candidateIndex][metric]!=null&&<circle key={snapshot.point.id} cx={x(index)} cy={y(snapshot.values[candidateIndex][metric]!)} r={index===activeIndex?5:2.8} fill={candidate.color} className={index===activeIndex?'race-chart-dot-active':''}/>)}</g>)}
    {last&&race.candidates.map((candidate,index)=>{const value=last.values[index][metric];if(value==null)return null;const labelY=Math.max(14,Math.min(BOTTOM-19,y(value)+(index===0?-24:17)));return <text key={`end-${candidate.key}`} x={snapshots.length===1?x(0):x(snapshots.length-1)-7} y={labelY} textAnchor={snapshots.length===1?'middle':'end'} fill={candidate.color} className="race-chart-end-label" pointerEvents="none" aria-hidden="true"><tspan>{formatValue(value,metric)}</tspan><tspan x={snapshots.length===1?x(0):x(snapshots.length-1)-7} dy="12" className="race-chart-end-secondary">{metric==='percent'?`${last.values[index].votes==null?'—':shortNumber(last.values[index].votes)} votos`:percent(last.values[index].percent)}</tspan></text>;})}
    {snapshots.map((snapshot,index)=>{const previous=index?x(index-1):0;const next=index<snapshots.length-1?x(index+1):width;const left=index?(previous+x(index))/2:0;const right=index<snapshots.length-1?(x(index)+next)/2:width;return <rect key={snapshot.point.id} ref={element=>{pointRefs.current[index]=element;}} x={left} y="0" width={right-left} height={HEIGHT} fill="transparent" className="race-chart-hit" role="button" aria-label={tooltipLabel(snapshot,index)} aria-pressed={activeIndex===index} tabIndex={activeIndex===index?0:-1} onPointerEnter={()=>selectPoint(index)} onClick={()=>selectPoint(index)} onFocus={()=>selectPoint(index)} onKeyDown={event=>keyboard(event,index)}/>;})}
   </svg><div className="race-chart-x-ticks" aria-hidden="true"><span>Parcial 1 · {time(snapshots[0].point.observedAt)}</span>{snapshots.length>1&&<span>Parcial {snapshots.length} · {time(snapshots.at(-1)!.point.observedAt)}</span>}</div></div></div>
   <div className="race-chart-observation"><div><Clock3 size={14}/><strong>Parcial {activeIndex+1}</strong><span>Observada {dateTime(active.point.observedAt)}</span></div><span>Seções totalizadas <strong>{percent(active.point.sectionsPercent)}</strong></span>{active.point.aggregation?<span>Geração das UFs: {time(active.point.aggregation.generatedAtMin)} – {time(active.point.aggregation.generatedAtMax)}</span>:<span>Gerada pelo TSE: {time(active.point.generatedAt)}</span>}</div>
   {snapshots.length===1&&<p className="race-chart-single"><Info size={13}/>Uma parcial observada. Novas publicações oficiais formarão a curva.</p>}
   {changes.includes(activeIndex)&&<p className="race-chart-turn"><ArrowLeftRight size={13}/>Mudança na posição relativa entre as duas candidaturas observada nesta parcial.</p>}
  </>:<div className="race-chart-empty"><div className="race-chart-empty-grid"/><Activity size={26}/><strong>Aguardando a evolução oficial</strong><p>{waitingMessage}</p></div>}
  <footer className="race-chart-footer"><span>Parciais oficiais observadas · espaçamento uniforme entre versões · dados TSE.</span><details><summary>Como ler o gráfico</summary><p>O eixo horizontal mostra a ordem das versões coletadas nesta instalação; o espaço entre pontos não representa tempo decorrido. Os segmentos apenas conectam parciais consecutivas disponíveis e não estimam valores intermediários nem a totalização futura. {query.region?'Percentuais regionais são calculados pela soma dos votos da candidatura sobre a soma dos votos computados a concorrentes (vvc). ':'Percentuais oficiais são sobre votos computados a concorrentes (vvc). '}O denominador não é substituído pelo total de votos válidos. A posição relativa destas duas candidaturas não determina eleição.</p>{query.region&&<p>O histórico regional começa com as somas estaduais coletadas para este recorte. Somente versões oficiais com cobertura completa e compatível entram na curva; o horário de geração pode variar entre UFs.</p>}<p>{number(race.excluded)} versões descartadas por fase, cobertura, duplicação ou incompatibilidade de recorte.{race.truncated?' Algumas versões contêm uma lista limitada de candidaturas; valores ausentes continuam indisponíveis.':''} Horários de geração do TSE sem fuso declarado são preservados; horários observados são apresentados em Brasília.</p></details></footer>
 </section>;
}

export default PresidentialRaceChart;
