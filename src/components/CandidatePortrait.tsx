import { useEffect, useRef, useState } from 'react';
import { portraitFailures } from '../lib/portrait-cache';
import './CandidatePortrait.css';

type PortraitCandidate = { name:string; photoUrl?:string };
type PortraitProps = { candidate:PortraitCandidate; size?:'small'|'medium'|'large'|'hero'; decorative?:boolean; eager?:boolean; className?:string };
const dimensions = { small:[42,50], medium:[56,66], large:[112,136], hero:[144,174] } as const;

/** Images are supplied by the official candidate record. A failed request stays an initial. */
export function CandidatePortrait({ candidate, size='medium', decorative=false, eager=false, className='' }:PortraitProps) {
 const [revision,setRevision]=useState(0);
 const [failedSource,setFailedSource]=useState('');
 const [visible,setVisible]=useState(false);
 const [foreground,setForeground]=useState(!document.hidden);
 const elementRef=useRef<HTMLSpanElement>(null);
 const [loadedSource,setLoadedSource]=useState('');
 const source=candidate.photoUrl?.trim() || '';
 const failed=failedSource===source||portraitFailures.hasFailure(source);
 const available=!!source && !portraitFailures.retryAt(source) && (!failed||visible&&foreground);
 const loaded=available && loadedSource===source;
 const words=candidate.name.trim().split(/\s+/).filter(Boolean);
 const initials=words.length ? `${words[0][0]}${words.length>1?words[words.length-1][0]:''}`.toLocaleUpperCase('pt-BR') : '—';
 const [width,height]=dimensions[size];
 useEffect(()=>{const element=elementRef.current;if(!element)return;const observer=new IntersectionObserver(entries=>setVisible(entries[0].isIntersecting));observer.observe(element);return()=>observer.disconnect();},[]);
 useEffect(()=>{const listener=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',listener);return()=>document.removeEventListener('visibilitychange',listener);},[]);
 useEffect(()=>{if(!source||!visible||!foreground)return;const deadline=portraitFailures.retryAt(source);if(!deadline)return;const timer=setTimeout(()=>setRevision(value=>value+1),Math.max(1,deadline-Date.now()+5));return()=>clearTimeout(timer);},[source,visible,foreground,revision]);
 return <span ref={elementRef} className={`candidate-portrait candidate-portrait-${size}${loaded?' candidate-portrait-loaded':''} ${className}`} role={decorative?undefined:'img'} aria-hidden={decorative||undefined} aria-label={decorative?undefined:loaded?`Retrato de ${candidate.name}, registro oficial do TSE`:available?`Retrato de ${candidate.name} carregando`:`Retrato indisponível de ${candidate.name}`}>
   <span className="candidate-portrait-initials" aria-hidden="true">{initials}</span>
   {available && <img key={source} src={source} alt="" aria-hidden="true" width={width} height={height} loading={eager?'eager':'lazy'} fetchPriority={eager?'auto':'low'} decoding="async" onLoad={()=>{portraitFailures.succeed(source);setFailedSource('');setLoadedSource(source);}} onError={()=>{portraitFailures.fail(source);setFailedSource(source);setLoadedSource('');setRevision(value=>value+1);}}/>}
 </span>;
}

export default CandidatePortrait;
