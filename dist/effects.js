/* Brief completion feedback. No background animation or idle animation loop. */
(()=>{
  'use strict';
  const KEY='shijie-fx-enabled';
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let enabled=true;
  try{enabled=localStorage.getItem(KEY)!=='false'}catch{}
  let canvas=null,ctx=null,raf=0,started=0,particles=[],width=0,height=0;
  const duration=720;
  function stop(){
    if(raf)cancelAnimationFrame(raf);
    raf=0;started=0;particles=[];
    if(canvas){canvas.hidden=true;ctx?.clearRect(0,0,width,height)}
  }
  function announce(){window.dispatchEvent(new CustomEvent('studyfxchange',{detail:{enabled,reducedMotion:motion.matches}}))}
  function setEnabled(value){
    enabled=Boolean(value);
    try{localStorage.setItem(KEY,String(enabled))}catch{}
    document.documentElement.classList.toggle('fx-disabled',!enabled);
    if(!enabled)stop();
    announce();return enabled;
  }
  function frame(time){
    raf=0;
    if(!enabled||motion.matches||document.hidden){stop();return}
    if(!started)started=time;
    const elapsed=time-started,t=elapsed/duration;
    if(t>=1){stop();return}
    ctx.clearRect(0,0,width,height);
    for(const p of particles){
      const distance=1-Math.pow(1-t,3),x=p.x+Math.cos(p.angle)*p.travel*distance,y=p.y+Math.sin(p.angle)*p.travel*distance+10*t*t;
      ctx.fillStyle=`rgba(${p.color},${(1-t)*.7})`;
      ctx.beginPath();ctx.arc(x,y,p.size*(1-t*.3),0,Math.PI*2);ctx.fill();
    }
    raf=requestAnimationFrame(frame);
  }
  function celebrate(){
    if(!enabled||motion.matches||document.hidden)return;
    stop();
    if(!canvas){
      canvas=document.createElement('canvas');canvas.id='particle-celebration';canvas.hidden=true;
      canvas.setAttribute('aria-hidden','true');canvas.setAttribute('role','presentation');
      document.body.append(canvas);
      try{ctx=canvas.getContext('2d',{alpha:true})}catch{}
    }
    if(!ctx)return;
    width=window.innerWidth;height=window.innerHeight;
    const dpr=Math.min(window.devicePixelRatio||1,1.5);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.style.width=width+'px';canvas.style.height=height+'px';ctx.setTransform(dpr,0,0,dpr,0,0);
    const anchor=document.activeElement?.getBoundingClientRect?.();
    const valid=anchor&&anchor.width&&anchor.height&&anchor.height<height*.5&&anchor.top>=0&&anchor.bottom<=height;
    const x=valid?anchor.left+anchor.width/2:width*.5,y=valid?anchor.top+anchor.height/2:Math.min(height*.4,300);
    particles=Array.from({length:width<720?8:12},(_,i)=>({x,y,angle:Math.PI*2*i/(width<720?8:12),travel:22+Math.random()*22,size:1.5+Math.random()*1.3,color:i%3?'0,102,204':'94,149,210'}));
    canvas.hidden=false;raf=requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop()});
  window.addEventListener('resize',stop,{passive:true});
  const motionChanged=()=>{if(motion.matches)stop();announce()};
  if(motion.addEventListener)motion.addEventListener('change',motionChanged);else motion.addListener?.(motionChanged);
  window.StudyFX={setEnabled,celebrate,isEnabled:()=>enabled};
  document.documentElement.classList.toggle('fx-disabled',!enabled);
})();
