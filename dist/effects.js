/* Ambient particle field. No dependencies or network requests. */
(()=>{
  'use strict';
  const KEY='shijie-fx-enabled';
  const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
  let canvas=document.getElementById('particle-field');
  if(!canvas){canvas=document.createElement('canvas');canvas.id='particle-field';document.body.prepend(canvas)}
  canvas.setAttribute('aria-hidden','true');canvas.setAttribute('role','presentation');canvas.tabIndex=-1;
  const ctx=canvas.getContext('2d',{alpha:true});
  if(!ctx){window.StudyFX={setEnabled:()=>false,celebrate:()=>{},isEnabled:()=>false};return}
  let enabled=true;
  try{enabled=localStorage.getItem(KEY)!=='false'}catch{}
  let width=0,height=0,dpr=1,points=[],bursts=[],raf=0,lastTime=0,resizePending=false;
  let burstCanvas=null,burstContext=null;
  let pointer={x:-9999,y:-9999};
  const rand=(min,max)=>min+Math.random()*(max-min);
  const mobile=()=>width<720;
  function resize(){
    width=window.innerWidth;height=window.innerHeight;
    dpr=Math.min(window.devicePixelRatio||1,mobile()?1.35:1.65);
    canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    canvas.style.width=width+'px';canvas.style.height=height+'px';
    ctx.setTransform(dpr,0,0,dpr,0,0);
    if(burstCanvas){burstCanvas.width=canvas.width;burstCanvas.height=canvas.height;burstCanvas.style.width=width+'px';burstCanvas.style.height=height+'px';burstContext?.setTransform(dpr,0,0,dpr,0,0)}
    const count=motion.matches?18:Math.max(18,Math.min(mobile()?25:58,Math.round(width*height/(mobile()?18000:24000))));
    points=Array.from({length:count},()=>({x:rand(0,width),y:rand(0,height),vx:rand(-.12,.12),vy:rand(-.12,.12),size:rand(.65,1.6),alpha:rand(.18,.47),hue:Math.random()<.23?'173,146,246':'106,205,232'}));
    resizePending=false;
  }
  function paint(delta,animate){
    ctx.clearRect(0,0,width,height);
    const dt=Math.min(delta/16.667,2.5),distance=mobile()?93:129;
    for(let i=0;i<points.length;i++){
      const p=points[i];
      if(animate){
        p.x+=p.vx*dt;p.y+=p.vy*dt;
        if(p.x<-5)p.x=width+5;if(p.x>width+5)p.x=-5;if(p.y<-5)p.y=height+5;if(p.y>height+5)p.y=-5;
        const dx=p.x-pointer.x,dy=p.y-pointer.y,dsq=dx*dx+dy*dy;
        if(dsq>1&&dsq<15000){const force=(1-Math.sqrt(dsq)/123)*.11*dt;p.x+=dx/Math.sqrt(dsq)*force;p.y+=dy/Math.sqrt(dsq)*force}
      }
      ctx.fillStyle=`rgba(${p.hue},${p.alpha})`;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();
      for(let j=i+1;j<points.length;j++){
        const q=points[j],dx=p.x-q.x,dy=p.y-q.y,dsq=dx*dx+dy*dy;
        if(dsq<distance*distance){const alpha=(1-Math.sqrt(dsq)/distance)*.09;ctx.strokeStyle=`rgba(102,182,224,${alpha})`;ctx.lineWidth=.65;ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()}
      }
    }
    if(burstContext)burstContext.clearRect(0,0,width,height);
    if(animate&&bursts.length&&burstContext){
      bursts=bursts.filter(b=>b.life>0);
      for(const b of bursts){b.life-=delta;b.x+=b.vx*dt;b.y+=b.vy*dt;b.vy+=.015*dt;const alpha=Math.max(0,b.life/b.duration)*.65;burstContext.fillStyle=`rgba(${b.hue},${alpha})`;burstContext.beginPath();burstContext.arc(b.x,b.y,b.size,0,Math.PI*2);burstContext.fill()}
    }
    if(burstCanvas)burstCanvas.hidden=!bursts.length;
  }
  function frame(time){
    raf=0;if(!enabled||document.hidden)return;
    if(resizePending)resize();
    if(motion.matches){paint(0,false);return}
    if(!lastTime)lastTime=time;
    const elapsed=time-lastTime;
    if(elapsed>=32){paint(elapsed,true);lastTime=time}
    raf=requestAnimationFrame(frame);
  }
  function stop(){if(raf)cancelAnimationFrame(raf);raf=0;lastTime=0;if(burstCanvas){burstCanvas.hidden=true;burstContext?.clearRect(0,0,width,height)}}
  function start(){stop();canvas.hidden=!enabled;if(!enabled){ctx.clearRect(0,0,width,height);bursts=[];return}if(document.hidden)return;if(resizePending||!width)resize();if(motion.matches)paint(0,false);else raf=requestAnimationFrame(frame)}
  function setEnabled(value){enabled=Boolean(value);try{localStorage.setItem(KEY,String(enabled))}catch{}document.documentElement.classList.toggle('fx-disabled',!enabled);start();window.dispatchEvent(new CustomEvent('studyfxchange',{detail:{enabled,reducedMotion:motion.matches}}));return enabled}
  function celebrate(){
    if(!enabled||motion.matches||document.hidden)return;
    if(!burstCanvas){burstCanvas=document.createElement('canvas');burstCanvas.id='particle-celebration';burstCanvas.setAttribute('aria-hidden','true');document.body.append(burstCanvas);burstContext=burstCanvas.getContext('2d');if(!burstContext)return;burstCanvas.width=canvas.width;burstCanvas.height=canvas.height;burstCanvas.style.width=width+'px';burstCanvas.style.height=height+'px';burstContext.setTransform(dpr,0,0,dpr,0,0)}
    const anchor=document.activeElement?.getBoundingClientRect?.();
    const valid=anchor&&anchor.width&&anchor.height&&anchor.height<height*.5&&anchor.top>=0&&anchor.top<height;
    const x=valid?anchor.left+anchor.width/2:width*.62,y=valid?anchor.top+anchor.height/2:height*.32;
    for(let i=0;i<(mobile()?12:20);i++){const a=rand(0,Math.PI*2),speed=rand(.45,1.7),duration=rand(550,950);bursts.push({x,y,vx:Math.cos(a)*speed,vy:Math.sin(a)*speed-.3,size:rand(1.1,2.4),life:duration,duration,hue:i%3?'110,224,247':'182,151,255'})}
    bursts=bursts.slice(-100);burstCanvas.hidden=false;
    if(!raf)start();
  }
  window.addEventListener('resize',()=>{resizePending=true;if(motion.matches){resize();if(enabled)paint(0,false)}else if(!raf&&enabled&&!document.hidden)start()},{passive:true});
  window.addEventListener('pointermove',e=>{if(!mobile()&&enabled&&!motion.matches){pointer.x=e.clientX;pointer.y=e.clientY}},{passive:true});
  window.addEventListener('pointerout',e=>{if(!e.relatedTarget)pointer={x:-9999,y:-9999}},{passive:true});
  document.addEventListener('visibilitychange',()=>document.hidden?stop():start());
  const motionChanged=()=>{bursts=[];resizePending=true;start()};
  if(motion.addEventListener)motion.addEventListener('change',motionChanged);else motion.addListener?.(motionChanged);
  window.StudyFX={setEnabled,celebrate,isEnabled:()=>enabled};
  document.documentElement.classList.toggle('fx-disabled',!enabled);resize();start();
})();
