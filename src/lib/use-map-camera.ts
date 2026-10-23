import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { createMapCamera, MAP_HOME, type MapFrame } from './map-camera';

export function useMapCamera(){
 const [frame,commit]=useState<MapFrame>(MAP_HOME);
 const frameRef=useRef(frame);
 const cameraRef=useRef<ReturnType<typeof createMapCamera>|null>(null);
 if(!cameraRef.current)cameraRef.current=createMapCamera({now:()=>performance.now(),request:callback=>requestAnimationFrame(callback),cancel:id=>cancelAnimationFrame(id)},next=>{frameRef.current=next;commit(next);});
 const reducedMotion=useRef(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
 useEffect(()=>{const media=window.matchMedia('(prefers-reduced-motion: reduce)');const change=()=>{reducedMotion.current=media.matches;if(media.matches)cameraRef.current?.finish();};media.addEventListener('change',change);return()=>{media.removeEventListener('change',change);cameraRef.current?.cancel();};},[]);
 const move=useCallback((next:SetStateAction<MapFrame>,duration=420,complete?:()=>void)=>{const camera=cameraRef.current!;camera.move(typeof next==='function'?next(camera.target()):next,reducedMotion.current?0:duration,complete);},[]);
 const immediate=useCallback((next:MapFrame)=>cameraRef.current!.move(next,0),[]);
 const rebase=useCallback((next:MapFrame)=>cameraRef.current!.rebase(next),[]);
 const cancel=useCallback(()=>cameraRef.current!.cancel(),[]);
 return {frame,frameRef,move,immediate,rebase,cancel};
}
