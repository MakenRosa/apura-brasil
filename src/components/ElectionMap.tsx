import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, Check, ChevronDown, ChevronRight, Compass, Expand, Globe2, Info, Layers, LoaderCircle, MapPin, Minus, MousePointer2, Plus, RefreshCw, Search, ShieldCheck, Vote, X } from 'lucide-react';
import type { Municipality, MunicipalMapEnvelope, RegionName, RegionalAggregation, RegionRow, RegionsEnvelope, ResultEnvelope, ResultQuery, SourceMeta, State } from '../../shared/types';
import { dateTime, getJSON, jsonCacheDeadline, number, params, percent, searchText, time } from '../lib/ui';
import { REGION_NAMES as REGIONS } from '../lib/regional-progress';
import type { RegionSelectorOption } from '../lib/region-selector';
import { boundFrame as bounded, fitFrame as fit, zoomFrame, MAP_HOME as INITIAL, MAP_WIDTH as WIDTH, MAP_HEIGHT as HEIGHT, type MapFrame as Frame } from '../lib/map-camera';
import { useMapCamera } from '../lib/use-map-camera';
import { createMapProjection, projectMapPoint, rebaseMapFrame, type MapProjection } from '../lib/map-projection';
import { createMapResource, createMapEntry } from '../lib/map-resource';
import { sectionVoteDistribution } from '../lib/section-vote-bar';
import { SectionVoteBar } from './SectionVoteBar';
import './ElectionMap.css';
import { CandidatePortrait } from './CandidatePortrait';

type Point = [number, number];
type Geometry = { type:'Polygon'; coordinates:Point[][] } | { type:'MultiPolygon'; coordinates:Point[][][] };
type GeoFeature = { type?:'Feature'; properties:Record<string,unknown>; geometry:Geometry | null };
type Collection = { type:'FeatureCollection'; features:GeoFeature[] };
export type ElectionMapProps = { states:State[]; query:ResultQuery; regions:RegionsEnvelope|null; nationalRows:RegionRow[]; nationalSource?:SourceMeta; regionOptions:Record<RegionName,RegionSelectorOption>; allowedStateCodes?:string[]; municipalities:Municipality[]; result:ResultEnvelope|null; waiting?:boolean; scheduledDate?:string; onSelectRegion:(region:RegionName|undefined)=>void; onSelectState:(uf:string)=>void; onSelectMunicipality:(id:string)=>void; onReset:()=>void; onShowResults:()=>void };
type MapFeature = { key:string; id:string|null; name:string; code:string; path:string; bounds:Frame; center:Point; uf?:string; region?:string; unavailableReason?:string; detail?:boolean; emerging?:boolean };
type OverviewExit = { features:MapFeature[]; rows:Map<string,RegionRow> };
type RegionFilter = 'all' | RegionName;
const PROGRESS_SCALE = [
 {value:0,color:'#3478d4'},
 {value:25,color:'#65cbc4'},
 {value:50,color:'#f4d55c'},
 {value:75,color:'#f38b37'},
 {value:100,color:'#d9363e'},
];
const NO_DATA_COLOR = '#23464d';
const progressGradient = `linear-gradient(90deg, ${PROGRESS_SCALE.map(stop=>`${stop.color} ${stop.value}%`).join(', ')})`;
const sourceNames:Record<string,string>={live:'Publicação disponível',cached:'Resposta em cache',stale:'Última resposta em cache',waiting:'Aguardando publicação',unavailable:'Fonte indisponível'};
const officeNames:Record<string,string>={'1':'Presidente','3':'Governador','5':'Senador','6':'Deputado Federal','7':'Deputado Estadual','8':'Deputado Distrital','11':'Prefeito','13':'Vereador','25':'Conselheiro Distrital'};
const phaseLabel = (source?:SourceMeta) => source?.phase==='simulation'?'Simulação do TSE':source?.phase==='unknown'?'Fase não identificada':source?sourceNames[source.state]:'Aguardando dados';
const progressColor = (value:number|null|undefined) => {
 if(value==null || !Number.isFinite(value))return NO_DATA_COLOR;
 const progress=Math.max(0,Math.min(100,value));
 const end=PROGRESS_SCALE.findIndex(stop=>stop.value>=progress);
 if(end===0)return PROGRESS_SCALE[0].color;
 const from=PROGRESS_SCALE[end-1],to=PROGRESS_SCALE[end];
 const fraction=(progress-from.value)/(to.value-from.value);
 return '#'+[1,3,5].map(offset=>Math.round(parseInt(from.color.slice(offset,offset+2),16)+(parseInt(to.color.slice(offset,offset+2),16)-parseInt(from.color.slice(offset,offset+2),16))*fraction).toString(16).padStart(2,'0')).join('');
};
const luminance = (color:string) => [1,3,5].map(offset=>{const channel=parseInt(color.slice(offset,offset+2),16)/255;return channel<=.04045?channel/12.92:((channel+.055)/1.055)**2.4;}).reduce((total,channel,index)=>total+channel*[.2126,.7152,.0722][index],0);
const progressInk = (value:number|null|undefined) => {
 const fill=luminance(progressColor(value)),dark='#000000',light='#ffffff';
 return (fill+.05)/(luminance(dark)+.05)>=(luminance(light)+.05)/(fill+.05)?dark:light;
};
const status = (row?:RegionRow) => !row || row.sectionsPercent==null?'Sem publicação de seções':row.finished?'Totalização concluída':row.sectionsCounted===0?'Totalização não iniciada':'Totalização em andamento';
const rings = (geometry:Geometry):Point[][] => geometry.type==='Polygon'?geometry.coordinates:geometry.coordinates.flat();
function projectionOf(collection:Collection|null):MapProjection|null {
 function* coordinates(){for(const feature of collection?.features||[])if(feature.geometry&&['Polygon','MultiPolygon'].includes(feature.geometry.type))for(const ring of rings(feature.geometry))yield* ring;}
 return createMapProjection(coordinates());
}
const viewport = (svg:SVGSVGElement) => { const rect=svg.getBoundingClientRect(); const ratio=WIDTH/HEIGHT; const width=Math.min(rect.width,rect.height*ratio),height=width/ratio;return {left:rect.left+(rect.width-width)/2,top:rect.top+(rect.height-height)/2,width,height}; };

function RegionalSourceDetails({ aggregation }: {aggregation:RegionalAggregation}) {
 return <div className="atlas-regional-sources"><div className="atlas-regional-sources-title"><strong>Arquivos estaduais da soma</strong><span>{number(aggregation.included.length)}/{number(aggregation.states.length)} estados</span></div><dl><div><dt>Cobertura</dt><dd>{aggregation.complete?'Completa':'Incompleta'}</dd></div><div><dt>Geração mais antiga</dt><dd>{dateTime(aggregation.generatedAtMin)}</dd></div><div><dt>Geração mais recente</dt><dd>{dateTime(aggregation.generatedAtMax)}</dd></div></dl>{aggregation.missing.length>0&&<p className="atlas-regional-missing">Sem dados compatíveis: {aggregation.missing.map(uf=>uf.toUpperCase()).join(', ')}.</p>}<ul>{aggregation.sources.map(entry=><li key={entry.uf}><div className="atlas-regional-source-row"><strong>{entry.uf.toUpperCase()} <span>{entry.name}</span></strong><em className={entry.included?'atlas-regional-source-included':''}>{entry.included?'Incluído':'Não incluído'}</em></div><span className="atlas-regional-source-state">{phaseLabel(entry.source)} · gerado {time(entry.source.generatedAt)}</span><span className="atlas-regional-source-checked">Verificado {time(entry.source.checkedAt)} · obtido {time(entry.source.fetchedAt)}</span>{!entry.included&&entry.source.message&&<p>{entry.source.message}</p>}{entry.source.url&&<a href={entry.source.url} target="_blank" rel="noreferrer">Arquivo TSE · {entry.uf.toUpperCase()}<ArrowRight size={10}/></a>}</li>)}</ul></div>;
}

function prepare(collection:Collection|null, states:State[], municipal:boolean, reference?:MapProjection|null):MapFeature[] {
 if(!collection?.features?.length)return [];
 const valid=collection.features.filter(feature=>feature.geometry && ['Polygon','MultiPolygon'].includes(feature.geometry.type));
 const projection=reference||projectionOf(collection);
 if(!projection)return [];
 const project=(point:Point):Point=>projectMapPoint(point,projection);
 return valid.flatMap((feature,index)=>{
  const p=feature.properties;
  const state=states.find(item=>String(p.codarea||p.CD_UF||p.ibge||'')===item.ibge || String(p.SIGLA_UF||p.sigla||'').toLowerCase()===item.uf.toLowerCase());
  const id=municipal?(typeof p.tseId==='string'?p.tseId:null):(state?.uf.toLowerCase()||null);
  const name=municipal?String(p.name||p.NM_MUN||'Município não identificado'):(state?.name||String(p.name||p.NM_UF||'UF não identificada'));
  const code=municipal?String(p.ibge||''):(state?.uf.toUpperCase()||'');
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity;
  const polygonPath=(polygon:Point[][])=>polygon.map(ring=>ring.map((point,i)=>{const [x,y]=project(point);left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);return `${i?'L':'M'}${x.toFixed(reference?4:2)},${y.toFixed(reference?4:2)}`;}).join(' ')+'Z').join(' ');
  const path=feature.geometry!.type==='Polygon'?polygonPath(feature.geometry!.coordinates):(feature.geometry!.coordinates.map(polygonPath).join(' '));
  if(!path || !Number.isFinite(left))return [];
  return [{key:`${municipal?'city':'uf'}-${code||index}`,id,name,code,path,bounds:{x:left,y:top,w:right-left,h:bottom-top},center:[(left+right)/2,(top+bottom)/2] as Point,uf:state?.uf,region:state?.region}];
 });
}

const MapShape = memo(function MapShape({ feature, row, selected, hovered, focused, preview=false, onHover, onSelect, onKey, onFocus, register }: {feature:MapFeature;row?:RegionRow;selected:boolean;hovered:boolean;focused:boolean;preview?:boolean;onHover:(key:string|null)=>void;onSelect:(feature:MapFeature)=>void;onKey:(event:ReactKeyboardEvent<SVGPathElement>,feature:MapFeature)=>void;onFocus:(feature:MapFeature)=>void;register:(key:string,node:SVGPathElement|null)=>void}) {
 const available=feature.id!==null||preview;
 const label=`${feature.name}. ${row?`${percent(row.sectionsPercent)} das seções totalizadas. ${status(row)}.`:'Sem dados de totalização publicados.'} ${preview?'Cartografia IBGE. Pressione Enter para aproximar. Consulta eleitoral aguarda configuração do TSE.':available?'Pressione Enter para explorar.':feature.unavailableReason||'Sem correspondência eleitoral oficial; consulta indisponível.'}`;
 return <path ref={node=>register(feature.key,node)} d={feature.path} fill={progressColor(row?.sectionsPercent)} className={`atlas-shape${feature.detail?' atlas-shape-detail':''}${feature.emerging?' atlas-shape-emerging':''}${selected?' atlas-shape-selected':''}${hovered?' atlas-shape-hovered':''}${!available?' atlas-shape-unlinked':''}`} vectorEffect="non-scaling-stroke" fillRule="evenodd" role="button" tabIndex={focused?0:-1} aria-label={label} aria-pressed={selected} aria-disabled={!available} onPointerEnter={()=>onHover(feature.key)} onPointerLeave={()=>onHover(null)} onFocus={()=>onFocus(feature)} onBlur={()=>onHover(null)} onKeyDown={event=>onKey(event,feature)} onClick={()=>onSelect(feature)}><title>{feature.name} · {percent(row?.sectionsPercent)} · {available?status(row):'Sem vínculo oficial'}</title></path>;
});

export function ElectionMap({ states,query,regions,nationalRows,nationalSource,regionOptions,allowedStateCodes,municipalities,result,waiting=false,scheduledDate,onSelectRegion,onSelectState,onSelectMunicipality,onReset,onShowResults }:ElectionMapProps) {
 const [national,setNational]=useState<Collection|null>(null);
 const [nationalError,setNationalError]=useState('');
 const [nationalLoading,setNationalLoading]=useState(true);
 const [municipalResponse,setMunicipalResponse]=useState<{key:string;data:MunicipalMapEnvelope}|null>(null);
 const [mapLoading,setMapLoading]=useState(false);
 const [mapError,setMapError]=useState('');
 const [enteringState,setEnteringState]=useState<string|null>(null);
 const resourcesRef=useRef<ReturnType<typeof createMapResource<MunicipalMapEnvelope>>|null>(null);
 if(!resourcesRef.current)resourcesRef.current=createMapResource((url,signal,options)=>getJSON<MunicipalMapEnvelope>(url,signal,options),4,300000,()=>Date.now(),jsonCacheDeadline);
 const entryRef=useRef(createMapEntry());
 const lastRetry=useRef(0);
 const cancelEntry=useCallback(()=>{entryRef.current.cancel();setEnteringState(null);},[]);
 const [retry,setRetry]=useState(0);
 const [overview,setOverview]=useState(!!query.region||query.uf==='br'||query.uf==='zz');
 const [overviewExit,setOverviewExit]=useState<OverviewExit|null>(null);
 const mapRegion:RegionFilter=query.region||'all';
 const {frame,frameRef,move:setFrame,immediate:setImmediateFrame,rebase:rebaseCamera,cancel:cancelCamera}=useMapCamera();
 const geometryFrame=useRef('');
 const returnedOverview=useRef(false);
 const [hovered,setHovered]=useState<string|null>(null);
 const [focusKey,setFocusKey]=useState<string|null>(null);
 const [find,setFind]=useState('');
 const [findOpen,setFindOpen]=useState(false);
 const [dragging,setDragging]=useState(false);
 const [wheelHint,setWheelHint]=useState(false);
 const [showLocations,setShowLocations]=useState(false);
 const [expanded,setExpanded]=useState(false);
 const [fullscreenError,setFullscreenError]=useState('');
 const atlasRef=useRef<HTMLElement>(null);
 const svgRef=useRef<SVGSVGElement>(null);
 const pathRefs=useRef(new Map<string,SVGPathElement>());
 const pointers=useRef(new Map<number,Point>());
 const drag=useRef<{point:Point;frame:Frame;started:boolean}|null>(null);
 const pinch=useRef<{distance:number;center:Point;frame:Frame}|null>(null);
 const suppressClickUntil=useRef(0);
 const hintTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const mapKey=params({...query,municipality:undefined});
 const navigationScope=useRef('');
 navigationScope.current=`${mapKey}:${query.municipality||''}:${waiting}`;
 const cartographyKey=waiting?`preview:${query.uf}`:mapKey;
 const municipal=municipalResponse?.key===cartographyKey?municipalResponse.data:resourcesRef.current.peek(cartographyKey);
 const setMunicipal=(data:MunicipalMapEnvelope|null)=>setMunicipalResponse(data?{key:cartographyKey,data}:null);
 const isMunicipal=!query.region && !overview && !['br','zz'].includes(query.uf);
 const awaitingState=!query.region && query.uf==='br' && query.office!=='1';
 const regionalUnavailable=['11','13','25'].includes(query.office);
 const state=states.find(item=>item.uf.toLowerCase()===query.uf.toLowerCase());
 const selectedCity=municipalities.find(item=>item.id===query.municipality);
 const currentResult = !waiting && result && result.query.cycle===query.cycle && result.query.turn===query.turn && result.query.office===query.office && result.query.uf===query.uf && (result.query.region||'')===(query.region||'') && (result.query.municipality||'')===(query.municipality||'') && (!query.electionId||result.query.electionId===query.electionId)?result:null;
 const selectedScope=currentResult?.data?.scope.name || query.region || selectedCity?.name || (query.uf==='br'?'Brasil':query.uf==='zz'?'Exterior':state?.name||query.uf.toUpperCase());
 const officeName=currentResult?.data?.office.name || officeNames[query.office] || `Cargo ${query.office}`;
 const summary=currentResult?.data?.summary;
 const resultSource=currentResult?.source;
 const aggregation=resultSource?.aggregation;
 const regionalStateCount=aggregation?.states.length || states.filter(item=>item.region===query.region && (allowedStateCodes===undefined||allowedStateCodes.includes(item.uf.toLowerCase()))).length;
 const regionalCoverage=aggregation?`${number(aggregation.included.length)}/${number(aggregation.states.length)} estados`:`Soma de ${number(regionalStateCount)} estados`;
 const regionalWarning=query.region && resultSource && (!currentResult?.data || aggregation?.complete===false || summary?.votesDisclosed===false) ? resultSource.message || (aggregation ? `Soma incompleta: ${number(aggregation.included.length)}/${number(aggregation.states.length)} estados com dados compatíveis. ${aggregation.missing.map(uf=>uf.toUpperCase()).join(', ')} sem dados utilizáveis.` : 'A soma regional ainda não está disponível.') : null;
 const mapSource=waiting?undefined:overviewExit?nationalSource:isMunicipal?regions?.source:nationalSource;
 const allowedKey=allowedStateCodes?.map(code=>code.toLowerCase()).join(',');
 const nationalFeatures=useMemo(()=>{const prepared=prepare(national,states,false);if(allowedKey===undefined)return prepared;const allowed=new Set(allowedKey.split(','));return prepared.map(feature=>feature.id&&!allowed.has(feature.id)?{...feature,id:null,unavailableReason:'Cargo indisponível nesta UF para o pleito selecionado.'}:feature);},[national,states,allowedKey]);
 const localCollection=useMemo<Collection|null>(()=>{if(!national||!state)return null;return {type:'FeatureCollection',features:national.features.filter(feature=>String(feature.properties.codarea||feature.properties.CD_UF||feature.properties.ibge||'')===state.ibge||String(feature.properties.SIGLA_UF||feature.properties.sigla||'').toLowerCase()===state.uf.toLowerCase())};},[national,state]);
 const nationalProjection=useMemo(()=>projectionOf(national),[national]);
 const outlineFeature=useMemo(()=>prepare(localCollection,states,false)[0],[localCollection,states]);
 const municipalFeatures=useMemo(()=>prepare(municipal?.collection||null,states,true),[municipal,states]);
 const features=useMemo(()=>overviewExit?overviewExit.features:isMunicipal?municipalFeatures:mapRegion==='all'?nationalFeatures:nationalFeatures.filter(feature=>feature.region===mapRegion),[overviewExit,isMunicipal,municipalFeatures,nationalFeatures,mapRegion]);
 const regionalMap=!isMunicipal && mapRegion!=='all';
 const overviewFrame=useMemo(()=>{
  if(isMunicipal || mapRegion==='all' || !features.length)return INITIAL;
  const left=Math.min(...features.map(feature=>feature.bounds.x));
  const top=Math.min(...features.map(feature=>feature.bounds.y));
  const right=Math.max(...features.map(feature=>feature.bounds.x+feature.bounds.w));
  const bottom=Math.max(...features.map(feature=>feature.bounds.y+feature.bounds.h));
  return fit({x:left,y:top,w:right-left,h:bottom-top});
 },[isMunicipal,mapRegion,features]);
 const featureMap=useMemo(()=>new Map(features.map(feature=>[feature.key,feature])),[features]);
 const rowMap=useMemo(()=>overviewExit?overviewExit.rows:new Map((waiting?[]:isMunicipal?regions?.rows||[]:nationalRows).filter(row=>isMunicipal?!!row.municipality:!row.municipality).map(row=>[isMunicipal?row.municipality!:row.uf.toLowerCase(),row])),[overviewExit,regions,nationalRows,isMunicipal,waiting]);
 const hoverFeature=hovered?featureMap.get(hovered):undefined;
 const hoverRow=hoverFeature?.id?rowMap.get(hoverFeature.id):undefined;
 const selectedFeature=isMunicipal?features.find(feature=>feature.id===query.municipality):features.find(feature=>feature.id===query.uf);
 const selectedRow=selectedFeature?.id?rowMap.get(selectedFeature.id):undefined;
 const allCandidates=currentResult?.data?.candidates||[];
 const availableCandidates=useMemo(()=>{const records=[...(currentResult?.data?.candidates||[])];return (query.turn===2?records.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')):records.sort((a,b)=>(b.votes??-1)-(a.votes??-1))).slice(0,query.turn===2?records.length:records.length<=15?15:8);},[currentResult,query.turn]);
 const allLocations=useMemo(()=>features.length?features.map(feature=>({key:feature.key,id:feature.id,name:feature.name,code:feature.code})):isMunicipal?municipalities.map(item=>({key:item.id,id:item.id,name:item.name,code:item.ibge||''})):states.filter(item=>mapRegion==='all'||item.region===mapRegion).map(item=>({key:item.uf,id:allowedKey===undefined||allowedKey.split(',').includes(item.uf.toLowerCase())?item.uf.toLowerCase():null,name:item.name,code:item.uf.toUpperCase()})),[features,municipalities,states,isMunicipal,allowedKey,mapRegion]);
 const searchMatches=useMemo(()=>allLocations.filter(location=>searchText(`${location.name} ${location.code}`).includes(searchText(find))).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR')),[allLocations,find]);
 const unavailableCount=isMunicipal?municipal?.coverage.unmatched||0:0;

 useEffect(()=>{const controller=new AbortController();let cancelled=false;setNationalLoading(true);setNationalError('');getJSON<Collection>('/brasil-uf.geojson',controller.signal,{revalidate:retry>0}).then(collection=>{if(cancelled)return;if(collection.type!=='FeatureCollection'||!Array.isArray(collection.features))throw new Error('A malha nacional recebida não pôde ser interpretada.');setNational(collection);}).catch(error=>{if(!cancelled)setNationalError(error instanceof Error?error.message:'Não foi possível carregar a malha nacional.');}).finally(()=>{if(!cancelled)setNationalLoading(false);});return()=>{cancelled=true;controller.abort();};},[retry]);
 useEffect(()=>{setOverview(!!query.region||query.uf==='br'||query.uf==='zz');setFind('');setFindOpen(false);setShowLocations(false);},[query.uf,query.region]);
 // Cancel the old navigation before the geometry layout effect starts the next camera movement.
 useLayoutEffect(()=>{cancelEntry();cancelCamera();setOverviewExit(null);pointers.current.clear();drag.current=null;pinch.current=null;setDragging(false);},[mapKey,waiting,cancelCamera,cancelEntry]);
 useEffect(()=>()=>{entryRef.current.cancel();resourcesRef.current?.clear();},[]);
 useEffect(()=>{if(query.region||['br','zz'].includes(query.uf)){setMunicipal(null);setMapLoading(false);return;}let cancelled=false;const resources=resourcesRef.current!;const manualRetry=lastRetry.current!==retry;if(manualRetry){resources.invalidate(cartographyKey);lastRetry.current=retry;}setMapError('');setMapLoading(!resources.peek(cartographyKey)?.collection);resources.load(cartographyKey,waiting?`/api/map-preview?uf=${encodeURIComponent(query.uf)}`:`/api/map?${mapKey}`,manualRetry).then(data=>{if(cancelled)return;setMunicipal(data);if(!data.collection)setMapError(data.geography.message||'O IBGE não disponibilizou a malha deste estado nesta consulta.');}).catch(error=>{if(!cancelled)setMapError(error instanceof Error?error.message:'Não foi possível obter a malha municipal.');}).finally(()=>{if(!cancelled)setMapLoading(false);});return()=>{cancelled=true;};},[mapKey,cartographyKey,retry,query.uf,query.region,waiting]);
 const geometryKey=overviewExit?'national':isMunicipal?`municipal:${query.uf}:${waiting?'preview':'linked'}`:'national';
 useLayoutEffect(()=>{if(overviewExit)return;if(geometryFrame.current!==geometryKey){geometryFrame.current=geometryKey;setImmediateFrame(isMunicipal?INITIAL:overviewFrame);}else if(!isMunicipal)setFrame(overviewFrame,520);setHovered(null);setFocusKey(features[0]?.key||null);setFind('');setFindOpen(false);},[overviewExit,isMunicipal,mapKey,features,overviewFrame,geometryKey,setFrame,setImmediateFrame]);
 useEffect(()=>{if(!overviewExit && isMunicipal && selectedFeature && query.municipality)setFrame(fit(selectedFeature.bounds));},[overviewExit,query.municipality,selectedFeature,isMunicipal]);
 useEffect(()=>()=>{if(hintTimer.current)clearTimeout(hintTimer.current);},[]);
 useEffect(()=>{const listener=()=>setExpanded(document.fullscreenElement===atlasRef.current);document.addEventListener('fullscreenchange',listener);return()=>document.removeEventListener('fullscreenchange',listener);},[]);
 useEffect(()=>{const node=svgRef.current;if(!node)return;const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey){setWheelHint(true);if(hintTimer.current)clearTimeout(hintTimer.current);hintTimer.current=setTimeout(()=>setWheelHint(false),2600);return;}event.preventDefault();cancelEntry();const rect=viewport(node);if(!rect.width||!rect.height)return;const current=frameRef.current;const anchor:[number,number]=[(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];const factor=Math.exp(Math.max(-0.35,Math.min(.35,event.deltaY*.002)));setFrame(zoomFrame(current,factor,anchor),160);};node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);},[features.length,geometryKey,setFrame,frameRef,cancelEntry]);
 const register=useCallback((key:string,node:SVGPathElement|null)=>{if(node)pathRefs.current.set(key,node);else pathRefs.current.delete(key);},[]);
 const setHover=useCallback((key:string|null)=>setHovered(key),[]);
 const zoom=(factor:number)=>{cancelEntry();setFrame(current=>zoomFrame(current,factor),320);};
 const selectLocation=useCallback((location:{id:string|null;key:string})=>{if(!location.id&&!(waiting&&isMunicipal))return;cancelEntry();setFind('');setFindOpen(false);setShowLocations(false);setHovered(null);const feature=featureMap.get(location.key);if(isMunicipal){if(feature)setFrame(fit(feature.bounds),520);if(location.id&&!waiting)onSelectMunicipality(location.id);}else if(location.id){const uf=location.id;setEnteringState(uf);const target=params({...query,uf,municipality:undefined,region:undefined});const key=waiting?`preview:${uf}`:target;const entry=entryRef.current.begin(()=>{setEnteringState(null);setOverview(false);onSelectState(uf);});void resourcesRef.current!.load(key,waiting?`/api/map-preview?uf=${encodeURIComponent(uf)}`:`/api/map?${target}`).then(entry.mapReady,entry.mapReady);if(feature)setFrame(fit(feature.bounds),420,entry.zoomReady);else entry.zoomReady();}},[isMunicipal,featureMap,onSelectMunicipality,onSelectState,waiting,setFrame,cancelEntry,query]);
 const selectFeature=useCallback((feature:MapFeature)=>{if(performance.now()<suppressClickUntil.current)return;selectLocation(feature);},[selectLocation]);
 const focusFeature=useCallback((feature:MapFeature)=>{setFocusKey(feature.key);setHovered(feature.key);const current=frameRef.current;const [x,y]=feature.center;if(x<current.x||x>current.x+current.w||y<current.y||y>current.y+current.h){cancelEntry();setFrame(bounded({...current,x:x-current.w/2,y:y-current.h/2}));}},[cancelEntry,setFrame,frameRef]);
 const featureKey=useCallback((event:ReactKeyboardEvent<SVGPathElement>,feature:MapFeature)=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();selectLocation(feature);return;}if(event.key==='Escape'){event.preventDefault();setHovered(null);return;}const index=features.findIndex(item=>item.key===feature.key);let next=index;if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%features.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index-1+features.length)%features.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=features.length-1;else return;event.preventDefault();const target=features[next];if(target){setFocusKey(target.key);pathRefs.current.get(target.key)?.focus();}},[features,selectLocation]);
 const pointerDown=(event:ReactPointerEvent<SVGSVGElement>)=>{if(event.pointerType==='mouse'&&event.button!==0)return;cancelEntry();cancelCamera();const point:Point=[event.clientX,event.clientY];pointers.current.set(event.pointerId,point);if(pointers.current.size===1)drag.current={point,frame:frameRef.current,started:false};else if(pointers.current.size===2){const [a,b]=[...pointers.current.values()];pinch.current={distance:Math.hypot(a[0]-b[0],a[1]-b[1]),center:[(a[0]+b[0])/2,(a[1]+b[1])/2],frame:frameRef.current};drag.current=null;setDragging(true);event.currentTarget.setPointerCapture(event.pointerId);}};
 const pointerMove=(event:ReactPointerEvent<SVGSVGElement>)=>{if(!pointers.current.has(event.pointerId))return;pointers.current.set(event.pointerId,[event.clientX,event.clientY]);const rect=viewport(event.currentTarget);if(pointers.current.size===2&&pinch.current){const [a,b]=[...pointers.current.values()];const start=pinch.current;const distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(distance<5)return;const w=Math.min(WIDTH,Math.max(WIDTH/18,start.frame.w*start.distance/distance));const sx=(start.center[0]-rect.left)/rect.width,sy=(start.center[1]-rect.top)/rect.height;const cx=((a[0]+b[0])/2-rect.left)/rect.width,cy=((a[1]+b[1])/2-rect.top)/rect.height;setImmediateFrame(bounded({x:start.frame.x+sx*start.frame.w-cx*w,y:start.frame.y+sy*start.frame.h-cy*w*HEIGHT/WIDTH,w,h:w*HEIGHT/WIDTH}));suppressClickUntil.current=performance.now()+400;return;}if(!drag.current)return;const start=drag.current,dx=event.clientX-start.point[0],dy=event.clientY-start.point[1];if(!start.started&&Math.hypot(dx,dy)<5)return;if(!start.started){start.started=true;setDragging(true);event.currentTarget.setPointerCapture(event.pointerId);setHovered(null);}setImmediateFrame(bounded({...start.frame,x:start.frame.x-dx/rect.width*start.frame.w,y:start.frame.y-dy/rect.height*start.frame.h}));suppressClickUntil.current=performance.now()+400;};
 const pointerUp=(event:ReactPointerEvent<SVGSVGElement>)=>{pointers.current.delete(event.pointerId);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(drag.current?.started||pinch.current)suppressClickUntil.current=performance.now()+350;pinch.current=null;if(pointers.current.size===1){drag.current={point:[...pointers.current.values()][0],frame:frameRef.current,started:true};}else{drag.current=null;setDragging(false);}};
 const toOverview=()=>{
  if(overviewExit)return;
  cancelEntry();setHovered(null);setFind('');setFindOpen(false);setShowLocations(false);setFocusKey(null);
  const scope=navigationScope.current;
  const restoreFocus=atlasRef.current?.querySelector('.atlas-breadcrumb button')===document.activeElement;
  const complete=()=>{
   setOverviewExit(null);
   if(navigationScope.current!==scope)return;
   returnedOverview.current=true;setOverview(true);onReset();
   if(restoreFocus)requestAnimationFrame(()=>atlasRef.current?.querySelector<HTMLButtonElement>('.atlas-breadcrumb button')?.focus({preventScroll:true}));
  };
  if(!nationalProjection||!nationalFeatures.length){setFrame(INITIAL,360,complete);return;}
  const collection=isMunicipal?(municipalFeatures.length?municipal?.collection||null:localCollection):national;
  const fromProjection=projectionOf(collection);
  const detail=isMunicipal&&municipalFeatures.length?prepare(municipal?.collection||null,states,true,nationalProjection).map(feature=>({...feature,detail:true})):[];
  // Municipalities replace their own UF while returning; no second state outline is drawn beneath them.
  const visibleKeys=new Set(features.map(feature=>feature.key));
  const countries=nationalFeatures.filter(feature=>!detail.length||feature.code.toLowerCase()!==query.uf.toLowerCase()).map(feature=>({...feature,emerging:isMunicipal?feature.code.toLowerCase()!==query.uf.toLowerCase():!visibleKeys.has(feature.key)}));
  const rows=new Map(rowMap);
  for(const row of waiting?[]:nationalRows)if(!row.municipality)rows.set(row.uf.toLowerCase(),row);
  returnedOverview.current=true;setOverviewExit({features:[...countries,...detail],rows});
  if(fromProjection)rebaseCamera(rebaseMapFrame(frameRef.current,fromProjection,nationalProjection));
  setFrame(INITIAL,720,complete);
 };
 const pending=isMunicipal?mapLoading:nationalLoading;
 const geographyError=isMunicipal?mapError:nationalError;
 const geographyWarnings=(municipal?.geography.warnings||[]).filter(message=>!message.startsWith('Malha simplificada municipal:')).map(message=>message.replace(/^1 nomes diferem/,'1 nome difere').replace('EA12 indisponível','Lista de municípios do TSE indisponível'));
 const mapName=overviewExit?'Brasil':isMunicipal?state?.name||query.uf.toUpperCase():regionalMap?mapRegion:'Brasil';
 const selectedMunicipalityName=selectedCity?.name||selectedFeature?.name||(query.municipality?'Município selecionado':null);
 const zoomValue=Math.round(WIDTH/frame.w*100);
 const currentStatus=summary?.finished?'Totalização concluída':summary?.sectionsCounted===0?'Não iniciada':summary?.sectionsCounted!=null?'Em totalização':'Aguardando publicação';
 const toggleExpanded=async()=>{setFullscreenError('');try{if(document.fullscreenElement===atlasRef.current)await document.exitFullscreen();else if(atlasRef.current?.requestFullscreen)await atlasRef.current.requestFullscreen();else setFullscreenError('Este navegador não oferece tela cheia para o mapa.');}catch{setFullscreenError('O navegador não permitiu ampliar o mapa. Você pode continuar explorando nesta tela.');}};
 const showResults=async()=>{if(document.fullscreenElement===atlasRef.current){try{await document.exitFullscreen();}catch{setFullscreenError('Use Esc para sair do mapa ampliado e abrir o resultado completo.');return;}}requestAnimationFrame(()=>onShowResults());};

 return <section ref={atlasRef} className={`atlas${expanded?' atlas-expanded':''}`} aria-label="Atlas da apuração eleitoral" aria-busy={!!overviewExit}>
  <div className="atlas-heading"><div><h2>{expanded?'Atlas da apuração':'Explore a apuração no mapa'}</h2>{expanded&&<p className="atlas-fullscreen-description">{officeName}<span>·</span>{query.cycle.replace(/^ele/,'')}<span>·</span>{query.turn}º turno<span>·</span>{selectedScope}</p>}</div><div className="atlas-heading-actions"><div className="atlas-heading-tag"><Layers size={15}/><span>Seções totalizadas</span></div><button className="atlas-expand-button" onClick={()=>void toggleExpanded()} aria-label={expanded?'Sair do mapa ampliado':'Expandir mapa em tela cheia'}>{expanded?<X size={15}/>:<Expand size={15}/>}<span>{expanded?'Sair do mapa ampliado':'Expandir mapa'}</span></button></div></div>
  {fullscreenError&&<div className="atlas-fullscreen-error" role="status"><Info size={15}/><span>{fullscreenError}</span><button aria-label="Fechar aviso de tela cheia" onClick={()=>setFullscreenError('')}><X size={14}/></button></div>}
  <div className="atlas-layout"><div className="atlas-map-panel" inert={!!overviewExit}>
   <div className={`atlas-toolbar${!isMunicipal?' atlas-toolbar-national':''}`}><div className="atlas-breadcrumb" aria-label="Nível do mapa"><button className={!isMunicipal?'atlas-current':''} onClick={toOverview}><Globe2 size={14}/>Brasil</button>{isMunicipal && <><ChevronRight size={13}/><button className={!query.municipality?'atlas-current':''} onClick={()=>{cancelEntry();setOverview(false);onSelectState(query.uf);setFrame(INITIAL);}}>{state?.uf.toUpperCase()||query.uf.toUpperCase()}</button>{query.municipality && <><ChevronRight size={13}/><span className="atlas-current atlas-city-crumb">{selectedMunicipalityName}</span></>}</>}</div>{!isMunicipal && <div className="atlas-region-filter"><Layers size={14} aria-hidden="true"/><select aria-label="Selecionar recorte regional da apuração" value={mapRegion} disabled={nationalLoading || !states.length || regionalUnavailable} title={regionalUnavailable?'Este cargo exige consulta municipal. Selecione uma UF e município.':query.turn===2?'Região e percentual de seções totalizadas. Selecione para explorar.':'Sigla da região, percentual de seções totalizadas, número de urna e votação dos dois candidatos mais votados. Selecione para explorar.'} aria-describedby={regionalUnavailable?'atlas-region-unavailable':undefined} onChange={event=>onSelectRegion(event.target.value==='all'?undefined:event.target.value as RegionName)}><option value="all">Todas as regiões</option>{REGIONS.map(region=><option key={region} value={region} disabled={allowedKey!==undefined&&!states.some(state=>state.region===region&&allowedKey.split(',').includes(state.uf.toLowerCase()))} title={regionOptions[region].title}>{regionOptions[region].label}</option>)}</select><ChevronDown size={13} aria-hidden="true"/></div>}<div className="atlas-search"><Search size={16}/><input aria-label={isMunicipal?'Buscar município no mapa':'Buscar estado no mapa'} placeholder={isMunicipal?'Buscar município…':regionalMap?`Buscar estado: ${mapRegion}…`:'Buscar estado…'} value={find} onFocus={()=>setFindOpen(true)} onChange={event=>{setFind(event.target.value);setFindOpen(true);}} onKeyDown={event=>{if(event.key==='Escape'){setFindOpen(false);event.currentTarget.blur();}if(event.key==='Enter'&&searchMatches[0]&&(searchMatches[0].id||waiting&&isMunicipal)){event.preventDefault();selectLocation(searchMatches[0]);}}} aria-expanded={findOpen} aria-controls="atlas-search-results"/>{find&&<button aria-label="Limpar busca" onClick={()=>setFind('')}><X size={13}/></button>}{findOpen && <div id="atlas-search-results" className="atlas-search-results"><div className="atlas-search-caption">{searchMatches.length?`${number(searchMatches.length)} ${isMunicipal?(searchMatches.length===1?'município':'municípios'):(searchMatches.length===1?'estado':'estados')}`:'Nenhum lugar encontrado'}<button aria-label="Fechar busca" onClick={()=>setFindOpen(false)}><X size={13}/></button></div>{searchMatches.slice(0,40).map(location=><button key={location.key} disabled={!location.id&&!(waiting&&isMunicipal)} onClick={()=>selectLocation(location)}><MapPin size={14}/><span>{location.name}<small>{location.id?isMunicipal?`Código TSE ${location.id}`:location.code:isMunicipal?waiting?'Cartografia IBGE · aproximar':'Sem vínculo eleitoral oficial':'Cargo indisponível neste pleito'}</small></span>{location.id&&<ChevronRight size={14}/>}</button>)}{searchMatches.length>40&&<p>Continue digitando para refinar a busca.</p>}</div>}</div></div>
   {!isMunicipal&&regionalUnavailable&&<p className="atlas-region-unavailable" id="atlas-region-unavailable">Este cargo exige consulta municipal. Selecione uma UF e município.</p>}
   <div className="atlas-map-data-bar" role="status"><span className={mapSource?.phase==='simulation'?'atlas-map-simulation-label':''}><i/>{waiting?'2º turno · aguardando configuração TSE':phaseLabel(mapSource)}</span><span>Seções: {mapSource?.generatedAt?`arquivo TSE ${time(mapSource.generatedAt)}`:'aguardando arquivo TSE'}</span></div>
   {mapSource?.phase==='simulation'&&<div className="atlas-map-simulation-warning">SIMULAÇÃO DO TSE · As cores representam dados de teste, sem resultado oficial da eleição.</div>}
   <div className={`atlas-stage${dragging?' atlas-dragging':''}`}>
    <div className="atlas-stage-label"><span>{overviewExit?'TERRITÓRIO NACIONAL':isMunicipal?'MALHA MUNICIPAL':regionalMap?'REGIÃO GEOGRÁFICA':'TERRITÓRIO NACIONAL'}</span><strong>{mapName}</strong><small>{overviewExit?'27 unidades da federação · cartografia IBGE':isMunicipal?`${number(municipal?.coverage.total)} ${query.uf==='df'?'localidade':municipal?.coverage.total===1?'município':'municípios'} · cartografia IBGE`:regionalMap?`${number(features.length)} unidades da federação · cartografia IBGE`:'27 unidades da federação · cartografia IBGE'}</small></div>
    <div className="atlas-compass" aria-hidden="true"><span>N</span><Compass size={31}/></div>
    {isMunicipal&&!features.length&&outlineFeature&&<svg className="atlas-svg atlas-state-placeholder" viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} aria-hidden="true"><path d={outlineFeature.path} fill={progressColor(waiting?undefined:nationalRows.find(row=>row.uf.toLowerCase()===query.uf)?.sectionsPercent)} fillRule="evenodd"/></svg>}
    {(overviewExit||enteringState||isMunicipal&&pending)&&<div className="atlas-detail-status" role="status"><i/><span>{overviewExit?'Voltando ao Brasil…':enteringState?`Abrindo ${states.find(state=>state.uf.toLowerCase()===enteringState)?.name||enteringState.toUpperCase()}…`:'Carregando divisões municipais…'}</span></div>}
    {features.length>0 && <svg ref={svgRef} key={geometryKey} className={`atlas-svg ${overviewExit?'atlas-geography-return':isMunicipal?'atlas-municipal-reveal':returnedOverview.current?'':'atlas-geography-enter'}`} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} aria-label={overviewExit?'Retornando ao mapa do Brasil':isMunicipal?`Mapa interativo dos municípios de ${mapName}`:regionalMap?`Mapa interativo das unidades da federação da região ${mapRegion}`:'Mapa interativo das unidades da federação do Brasil'} role="group" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onContextMenu={event=>{if(dragging)event.preventDefault();}}><g>{features.map((feature,index)=><MapShape key={feature.key} feature={feature} row={feature.id?rowMap.get(feature.id):undefined} selected={!!feature.id&&(isMunicipal?feature.id===query.municipality:feature.id===query.uf)} hovered={hovered===feature.key} focused={focusKey===feature.key||(!focusKey&&index===0)} preview={waiting&&isMunicipal} onHover={setHover} onSelect={selectFeature} onKey={featureKey} onFocus={focusFeature} register={register}/>)}</g>{(!isMunicipal||overviewExit)&&(overviewExit?nationalFeatures:features).map(feature=><text key={`label-${feature.key}`} x={feature.center[0]} y={feature.center[1]} className="atlas-uf-label" textAnchor="middle" dominantBaseline="central" style={{fontSize:13*frame.w/WIDTH,fill:progressInk(feature.id?rowMap.get(feature.id)?.sectionsPercent:undefined),stroke:'none'}} pointerEvents="none">{feature.code}</text>)}</svg>}
    {((pending&&!(isMunicipal&&outlineFeature))||(!features.length&&geographyError)) && <div className="atlas-map-state" role="status">{pending?<><span className="atlas-loading-icon"><LoaderCircle size={29}/></span><h3>{isMunicipal?'Aproximando o mapa municipal…':'Preparando o mapa do Brasil…'}</h3><p>Consultando a cartografia oficial do IBGE.</p></>:<><MapPin size={30}/><h3>A cartografia está indisponível.</h3><p>{geographyError}</p><button className="atlas-button" onClick={()=>setRetry(value=>value+1)}><RefreshCw size={15}/>Tentar novamente</button><button className="atlas-link-button" onClick={()=>setShowLocations(true)}>Explorar pela lista<ArrowRight size={14}/></button></>}</div>}
    {!pending&&!features.length&&!geographyError&&!(isMunicipal&&outlineFeature) && <div className="atlas-map-state"><MapPin size={30}/><h3>Sem malha territorial disponível.</h3><p>Os dados eleitorais podem ser consultados na lista de localidades abaixo.</p><button className="atlas-button" onClick={()=>setShowLocations(true)}>Abrir localidades<ArrowRight size={14}/></button></div>}
    {hoverFeature && <div className="atlas-tooltip" role="status"><div><MapPin size={14}/><strong>{hoverFeature.name}</strong></div><span>{waiting?'Cartografia IBGE · consulta eleitoral em espera':hoverFeature.id?status(hoverRow):hoverFeature.unavailableReason||'Sem vínculo eleitoral oficial'}</span>{!waiting&&<dl><div><dt>Seções totalizadas</dt><dd>{percent(hoverRow?.sectionsPercent)}</dd></div><div><dt>Seções</dt><dd>{number(hoverRow?.sectionsCounted)} / {number(hoverRow?.sectionsTotal)}</dd></div></dl>}<small>{waiting?isMunicipal?'Clique ou pressione Enter para aproximar esta localidade.':'Clique ou pressione Enter para explorar a geografia do estado.':hoverFeature.id?'Clique ou pressione Enter para explorar.':hoverFeature.unavailableReason||'Consulta desabilitada: identificação eleitoral não confirmada.'}</small></div>}
    <div className="atlas-zoom" aria-label="Controles do mapa"><button aria-label="Aproximar mapa" title="Aproximar" disabled={frame.w<=WIDTH/18+.1||!features.length} onClick={()=>zoom(.72)}><Plus size={19}/></button><span>{overviewExit?'…':`${zoomValue}%`}</span><button aria-label="Afastar mapa" title="Afastar" disabled={frame.w>=WIDTH||!features.length} onClick={()=>zoom(1/.72)}><Minus size={19}/></button><i/><button aria-label="Encaixar todo o território" title="Encaixar território" onClick={()=>{cancelEntry();setFrame(isMunicipal?INITIAL:overviewFrame);}} disabled={!features.length}><Expand size={18}/></button>{selectedFeature && query.municipality && <button aria-label="Encaixar município selecionado" title="Encaixar município selecionado" onClick={()=>{cancelEntry();setFrame(fit(selectedFeature.bounds));}}><MapPin size={17}/></button>}</div>
    {wheelHint&&<div className="atlas-wheel-hint" role="status">Use Ctrl + rolagem para aproximar o mapa.</div>}
    <div className="atlas-map-instruction"><MousePointer2 size={13}/><span>{isMunicipal?waiting?'Clique em um município para aproximar':'Clique em um município para consultar':'Clique em um estado para explorar'}<b> · </b>arraste para mover</span></div>
   </div>
   <div className="atlas-map-bottom"><div className="atlas-legend"><span>SEÇÕES TOTALIZADAS · ESCALA CONTÍNUA</span><div className="atlas-legend-content"><div className="atlas-progress-scale" role="img" aria-label="Escala contínua de seções totalizadas: azul em 0%, ciano em 25%, amarelo em 50%, laranja em 75% e vermelho em 100%. Mesma escala em todos os mapas."><div className="atlas-progress-gradient" style={{background:progressGradient}}/><div className="atlas-progress-ticks">{PROGRESS_SCALE.map(stop=><span key={stop.value} style={{left:`${stop.value}%`}}>{stop.value}%</span>)}</div></div><span className="atlas-no-data"><i/>Sem dados</span></div></div><button className="atlas-locations-toggle" onClick={()=>setShowLocations(!showLocations)} aria-expanded={showLocations}><Layers size={15}/>{showLocations?'Fechar lista':'Lista de localidades'}<ChevronRight size={13} className={showLocations?'atlas-chevron-open':''}/></button></div>
   {showLocations && <div className="atlas-locations"><div className="atlas-locations-heading"><strong>Explore com a lista</strong><span>{number(allLocations.length)} localidades{isMunicipal&&unavailableCount?` · ${number(unavailableCount)} sem vínculo oficial`:''}</span></div><div className="atlas-locations-grid">{allLocations.map(location=><button key={location.key} disabled={!location.id&&!(waiting&&isMunicipal)} className={location.id===query.municipality?'atlas-location-selected':''} onClick={()=>selectLocation(location)}><span>{location.name}<small>{location.id?isMunicipal?`Código TSE ${location.id}`:location.code:isMunicipal?waiting?'Cartografia IBGE · aproximar':'Sem vínculo eleitoral oficial':'Cargo indisponível neste pleito'}</small></span><ChevronRight size={14}/></button>)}</div>{!allLocations.length&&<p>A lista oficial de localidades ainda não está disponível nesta consulta.</p>}</div>}
   <div className="atlas-provenance"><span><ShieldCheck size={12}/>{isMunicipal&&municipal?.geography.url?<a href={municipal.geography.url} target="_blank" rel="noreferrer">Cartografia IBGE</a>:<span>Cartografia IBGE</span>}<span>· dados eleitorais TSE</span></span><span>{isMunicipal?municipal?.geography.state==='stale'?'Cartografia em cache antigo':municipal?.geography.state==='cached'?'Cartografia em cache':'Geometria oficial':'Mapa nacional oficial'}{isMunicipal&&municipal?.coverage?` · ${number(municipal.coverage.linked)}/${number(municipal.coverage.total)} vínculos confirmados`:''}</span></div>
   {isMunicipal&&geographyWarnings.length ? <div className="atlas-geography-warning"><Info size={14}/><span>{geographyWarnings.join(' ')}</span></div>:null}
  </div>
  <aside className="atlas-context atlas-context-compact" aria-label="Resultados do recorte em consulta">
   <div className="atlas-context-top"><div className="atlas-context-title"><h3>{selectedScope}</h3><span className={`atlas-source-badge${resultSource?.phase==='simulation'?' atlas-source-simulated':''}`}><i/>{waiting?'Aguardando configuração TSE':phaseLabel(resultSource)}</span></div><p>{officeName}<span> · </span>{query.turn}º turno{query.region&&<span className="atlas-regional-coverage" title={aggregation?`Soma dos arquivos TSE de ${aggregation.states.map(uf=>uf.toUpperCase()).join(', ')}`:undefined}>{regionalCoverage}</span>}</p>{!query.region&&overview&&query.uf!=='br'&&<div className="atlas-preserved-query"><Globe2 size={12}/>Mapa: Brasil · consulta: {selectedScope}</div>}</div>
   {regionalWarning&&<div className="atlas-regional-warning" role="status"><Info size={12}/><span>{regionalWarning}</span></div>}
   {resultSource?.phase==='simulation'&&<div className="atlas-context-warning">SIMULAÇÃO DO TSE. Dados de teste, sem resultado oficial da eleição.</div>}
   <div className="atlas-context-progress"><div><span>Seções totalizadas</span><strong>{percent(summary?.sectionsPercent)}</strong></div><SectionVoteBar distribution={sectionVoteDistribution(query,currentResult,summary?.sectionsPercent)}/><small>{number(summary?.sectionsCounted)} / {number(summary?.sectionsTotal)} seções <span>· {currentStatus}</span></small></div>
   <details className="atlas-context-statistics"><summary>Eleitorado e comparecimento<ChevronRight size={12}/></summary><div className="atlas-context-metrics"><div><span>Eleitorado</span><strong>{number(summary?.electorate)}</strong></div><div><span>Comparecimento</span><strong>{number(summary?.turnout)}</strong></div></div></details>
   <div className="atlas-context-candidates"><div className="atlas-context-section-title"><h4>{query.region?'Candidaturas · região':'Candidaturas'}</h4><span>{!currentResult?.data?'—':availableCandidates.length===allCandidates.length?number(allCandidates.length):`${number(availableCandidates.length)} de ${number(allCandidates.length)}`}</span></div>{query.region&&!waiting&&<p className="atlas-regional-percent-note">% sobre os votos computados somados.{query.turn!==2&&' A posição não define eleição.'}</p>}{availableCandidates.length?<div className="atlas-mini-candidates" tabIndex={0} aria-label="Lista de candidaturas do recorte; role para ver mais">{availableCandidates.map(candidate=><article key={`${candidate.uf||''}:${candidate.id}`}><CandidatePortrait candidate={candidate} size="small" decorative/><div><strong>{candidate.name}</strong><span>{candidate.party||'Partido não informado'} · {candidate.number}{candidate.uf&&<b className="atlas-candidate-uf">{candidate.uf.toUpperCase()}</b>}{candidate.elected===true&&<em><Check size={9}/>Eleito pelo TSE</em>}</span></div><div className="atlas-candidate-numbers"><strong>{percent(candidate.percent)}</strong><span>{number(candidate.votes)} votos</span></div></article>)}</div>:<div className="atlas-no-results"><span><Vote size={24}/></span><strong>{waiting?'Segundo turno em preparação':awaitingState ? 'Selecione um estado.' : 'Aguardando o resultado deste lugar.'}</strong><p>{waiting?`A navegação mostra a cartografia do IBGE. Resultados e candidaturas dependem da configuração oficial do TSE${scheduledDate?' para '+scheduledDate.split('-').reverse().join('/'):''}.`:awaitingState ? `Escolha uma UF no mapa para consultar ${officeName.toLowerCase()}.` : currentResult?.source.message || 'O painel será preenchido quando a fonte oficial disponibilizar esta consulta.'}</p></div>}{!awaitingState && !waiting && <div className="atlas-candidate-list-footer"><span>{query.region?'% sobre votos computados somados · recorte regional':'% de votos a concorrentes · retratos TSE'}</span><button className="atlas-results-button" onClick={()=>void showResults()}>{allCandidates.length>15?'Ver todas as candidaturas':'Ver resultado completo'}<ArrowRight size={14}/></button></div>}</div>
   <details className="atlas-context-source"><summary><span><ShieldCheck size={12}/>Fonte e horários</span><ChevronRight size={12}/></summary><div className="atlas-context-source-expanded"><span>{waiting?'Cartografia IBGE para navegação. A disponibilidade eleitoral de cada UF será definida pela configuração publicada pelo TSE.':query.region?'Recorte regional calculado com arquivos oficiais de cada UF. Percentuais sobre os votos computados somados; situação eleitoral conforme a UF de origem.':query.turn===2?'Registros individuais da publicação oficial do TSE, apresentados por nome.':'Dados oficiais do TSE. A posição na lista não define eleição.'}</span><dl>{!aggregation&&<div><dt>Gerado pelo TSE</dt><dd>{time(resultSource?.generatedAt)}</dd></div>}<div><dt>Verificado em Brasília</dt><dd>{time(resultSource?.checkedAt)}</dd></div></dl>{resultSource?.url&&<a href={resultSource.url} target="_blank" rel="noreferrer">{aggregation?'Arquivos do recorte regional (JSON)':'Arquivo desta consulta'}<ArrowRight size={12}/></a>}{aggregation&&<RegionalSourceDetails aggregation={aggregation}/>} {query.uf==='zz'&&<p>Exterior mantém a consulta de resultados. A cartografia exibe o Brasil para navegação.</p>}</div></details>
  </aside></div>
 </section>;
}

export default ElectionMap;
