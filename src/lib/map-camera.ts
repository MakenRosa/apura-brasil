export type MapFrame = { x:number; y:number; w:number; h:number };
export const MAP_WIDTH=1000;
export const MAP_HEIGHT=700;
export const MAP_HOME:MapFrame={x:0,y:0,w:MAP_WIDTH,h:MAP_HEIGHT};

export function boundFrame(frame:MapFrame):MapFrame {
 const w=Math.min(MAP_WIDTH,Math.max(MAP_WIDTH/18,frame.w));
 const h=w*MAP_HEIGHT/MAP_WIDTH;
 return {x:Math.min(MAP_WIDTH-w+65,Math.max(-65,frame.x)),y:Math.min(MAP_HEIGHT-h+65,Math.max(-65,frame.y)),w,h};
}
export function fitFrame(bounds:MapFrame):MapFrame {
 const w=Math.min(MAP_WIDTH,Math.max(95,bounds.w*1.24,bounds.h*1.24*MAP_WIDTH/MAP_HEIGHT));
 return boundFrame({x:bounds.x+bounds.w/2-w/2,y:bounds.y+bounds.h/2-w*MAP_HEIGHT/MAP_WIDTH/2,w,h:w*MAP_HEIGHT/MAP_WIDTH});
}
export function zoomFrame(frame:MapFrame,factor:number,anchor:[number,number]=[.5,.5]):MapFrame {
 const w=Math.max(MAP_WIDTH/18,Math.min(MAP_WIDTH,frame.w*factor)),h=w*MAP_HEIGHT/MAP_WIDTH;
 return boundFrame({x:frame.x+anchor[0]*(frame.w-w),y:frame.y+anchor[1]*(frame.h-h),w,h});
}
export function interpolateFrame(from:MapFrame,to:MapFrame,progress:number,constrain=true):MapFrame {
 if(progress<=0)return {...from};
 if(progress>=1)return {...to};
 const t=progress<.5?4*progress**3:1-(-2*progress+2)**3/2;
 const w=Math.exp(Math.log(from.w)+(Math.log(to.w)-Math.log(from.w))*t),h=w*MAP_HEIGHT/MAP_WIDTH;
 const cx=from.x+from.w/2+(to.x+to.w/2-from.x-from.w/2)*t;
 const cy=from.y+from.h/2+(to.y+to.h/2-from.y-from.h/2)*t;
 const frame={x:cx-w/2,y:cy-h/2,w,h};
 return constrain?boundFrame(frame):frame;
}

type AnimationClock={now:()=>number;request:(callback:(time:number)=>void)=>number;cancel:(id:number)=>void};
/** A new navigation or a pointer gesture cancels both frames and deferred scope changes. */
export function createMapCamera(clock:AnimationClock,commit:(frame:MapFrame)=>void) {
 let current={...MAP_HOME},target={...MAP_HOME},job:number|null=null,version=0,onFinish:(()=>void)|undefined;
 function cancel(){version++;if(job!==null)clock.cancel(job);job=null;target={...current};onFinish=undefined;}
 /** Projection changes preserve the visible extent, including very small UFs. */
 function rebase(next:MapFrame){cancel();current={...next};target={...next};commit(current);}
 function move(next:MapFrame,duration=420,complete?:()=>void){
  cancel();target=boundFrame(next);onFinish=complete;
  const from={...current},destination={...target},token=version,start=clock.now();
  const apply=(frame:MapFrame)=>{current=frame;commit(frame);};
  if(duration<=0){apply(destination);onFinish=undefined;complete?.();return;}
  const tick=(now:number)=>{
   if(token!==version)return;
   const progress=Math.max(0,Math.min(1,(now-start)/duration));
   apply(interpolateFrame(from,destination,progress,false));
   if(progress<1)job=clock.request(tick);
   else {job=null;onFinish=undefined;complete?.();}
  };
  job=clock.request(tick);
 }
 function finish(){const destination={...target},complete=onFinish;cancel();current=destination;target=destination;commit(destination);complete?.();}
 return {move,rebase,cancel,finish,current:()=>current,target:()=>target};
}
