import {sampleScene,terminalProjection} from './fixture.mjs';
const P=globalThis.PIXI,host=document.querySelector('#world');
const renderOptions=new URLSearchParams(location.search);
const app=new P.Application();
await app.init({resizeTo:host,background:'#dbe2c6',antialias:false,resolution:devicePixelRatio,autoDensity:true,preference:'webgl',preferWebGLVersion:renderOptions.get('gl')==='1'?1:2,preserveDrawingBuffer:renderOptions.has('preserve')});
host.prepend(app.canvas);app.ticker.stop();
P.TextureStyle.defaultOptions.scaleMode='nearest';
const atlas=await P.Assets.load('/assets/actors.png');
const frames=Array.from({length:2},(_,variant)=>Array.from({length:6},(_,frame)=>new P.Texture({source:atlas.source,frame:new P.Rectangle(frame*32,variant*48,32,48)})));
const world=new P.Container(),ground=new P.Graphics(),objects=new P.Container(),ambient=new P.Graphics(),selection=new P.Graphics();
app.stage.addChild(world);world.addChild(ground,ambient,objects,selection);objects.sortableChildren=true;
const r=(g,x,y,w,h,c)=>g.rect(x,y,w,h).fill(c);
// Deterministic square-grid terrain, authored independently of execution state.
r(ground,0,0,304,224,0xdbe2c6);
for(let y=12;y<212;y+=8)for(let x=8;x<300;x+=8){const seed=(x*17+y*31)%19;r(ground,x,y,8,8,[0xc1d39a,0xbace91,0xc7d8a1,0xc1d39a][seed%4]);if(seed%5===0)r(ground,x+2,y+3,2,1,0xa4bc80);}
for(let x=44;x<279;x+=8)for(let y=126;y<154;y+=8)r(ground,x,y,8,8,(x+y)%3?0xd8c18f:0xdfcb9e);
for(let x=104;x<240;x+=8)for(let y=77;y<98;y+=8)r(ground,x,y,8,8,0xddc997);
for(let y=93;y<140;y+=8){r(ground,108,y,16,8,0xddc997);r(ground,219,y,16,8,0xddc997);}
const prop=(x,y,type)=>{const g=new P.Graphics();g.position.set(x,y);g.zIndex=y;
 if(type==='tree'){r(g,-18,-7,37,11,0x9eb77b);r(g,-4,-31,9,33,0x71543c);r(g,-3,-30,3,29,0x997548);r(g,-22,-57,43,30,0x3f6649);r(g,-28,-50,54,18,0x3f6649);r(g,-22,-58,39,17,0x557b50);r(g,-15,-65,25,23,0x638b53);r(g,-24,-49,13,12,0x7f9c5e);r(g,-7,-61,14,8,0x95ae67);r(g,13,-47,9,11,0x4a714a);}
 else if(type==='plant'){r(g,-7,-10,14,10,0xa9744c);r(g,-9,-13,18,4,0xcc9561);r(g,-2,-29,4,17,0x598052);r(g,-10,-25,9,7,0x7c9d57);r(g,1,-32,8,9,0x8ca85e);r(g,1,-22,10,6,0x658a4b);}
 else {r(g,-8,-3,17,5,0xa9ba86);r(g,-9,-10,16,9,0x88998b);r(g,-6,-13,10,6,0xabb8a4);}
 objects.addChild(g);return g;};
prop(170,150,'tree');prop(36,87,'tree');prop(275,68,'tree');prop(274,158,'plant');prop(251,72,'plant');prop(49,164,'rock');prop(92,190,'rock');prop(209,191,'plant');prop(18,142,'plant');
const sprites=new Map();let selected='worker-a',state=sampleScene(0),lastCamera={zoom:1,x:0,y:0},playing=false,lastTick=0;
const params={time:0,count:2,scenario:'normal',reduced:false,height:48,player:'sampler'};
function updateActors(scene){
 for(const sprite of sprites.values())sprite.visible=false;
 for(const actor of scene.actors){let sprite=sprites.get(actor.id);if(!sprite){sprite=new P.AnimatedSprite(frames[actor.variant]);sprite.autoUpdate=false;sprite.anchor.set(.5,44/48);sprite.eventMode='static';sprite.cursor='pointer';sprite.on('pointertap',()=>{selected=actor.id;paint();});objects.addChild(sprite);sprites.set(actor.id,sprite);}
  sprite.visible=true;sprite.textures=frames[actor.variant];
  // Compare library frame selection to direct texture sampling at seekable time.
  if(params.player==='library')sprite.gotoAndStop(actor.frame);else sprite.texture=frames[actor.variant][actor.frame];
  const size=params.height/48;sprite.scale.set((actor.facing==='left'?-1:1)*size,size);sprite.position.set(Math.round(actor.x),Math.round(actor.y));sprite.zIndex=actor.y;
 }
}
function paint(){
 state=sampleScene(params.time,params.count,params.scenario,params.reduced);
 const scale=Math.max(1,Math.floor(Math.min(host.clientWidth/304,host.clientHeight/224)))*lastCamera.zoom;
 world.scale.set(scale);world.position.set(Math.floor((host.clientWidth-304*scale)/2)+lastCamera.x,Math.floor((host.clientHeight-224*scale)/2)+lastCamera.y);
 updateActors(state);ambient.clear();selection.clear();
 // Ambient water and foliage stop when coverage is stale; never imply liveness.
 const motion=params.reduced||state.phase==='interrupted'?0:Math.floor(params.time/420)%2;
 r(ambient,20,182,43,18,0x7faeb1);r(ambient,23,185+motion,16,2,0xb2d0be);r(ambient,43,192-motion,14,2,0xb2d0be);
 for(let i=0;i<5;i++){r(ambient,76+i*5+motion,44+(i%2)*3,2,5,0x88a65f);}
 const actor=state.actors.find(a=>a.id===selected)||state.actors[0];
 selection.ellipse(Math.round(actor.x),Math.round(actor.y)+1,13*params.height/48,4).stroke({width:1,color:0xf9f0c6});
 const labelColor=state.phase==='interrupted'?0xb16a44:0x3f654f;
 r(selection,Math.round(actor.x)-2,Math.round(actor.y)-params.height+1,4,3,labelColor);
 app.renderer.render(app.stage);
 document.querySelector('#selected').textContent=actor.id;document.querySelector('#phase-label').textContent=state.phase;
 document.querySelector('#status').textContent=state.status;document.querySelector('#coverage').textContent=state.coverage;
 document.querySelector('#facing').textContent=actor.facing;document.querySelector('#clock').textContent=`${(params.time/1000).toFixed(2)} / 8.00 s`;
 document.querySelector('#time').value=params.time;document.querySelector('#terminal').textContent=terminalProjection(state);document.body.dataset.alert=String(state.phase==='interrupted');
 return state;
}
function tick(now){if(playing){params.time=Math.min(8000,params.time+Math.max(0,now-lastTick));if(params.time===8000){playing=false;document.querySelector('#play').textContent='Play';}paint();}lastTick=now;requestAnimationFrame(tick);}
requestAnimationFrame(tick);
document.querySelector('#play').onclick=()=>{if(params.time>=8000)params.time=0;playing=!playing;document.querySelector('#play').textContent=playing?'Pause':'Play';};
document.querySelector('#time').oninput=e=>{playing=false;params.time=Number(e.target.value);paint();};
for(const id of ['scenario','count','height','reduced'])document.querySelector(`#${id}`).onchange=e=>{params[id]=id==='reduced'?e.target.checked:id==='scenario'?e.target.value:Number(e.target.value);paint();};
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['SELECT','INPUT'].includes(document.activeElement.tagName)){e.preventDefault();document.querySelector('#play').click();}});
host.addEventListener('wheel',e=>{e.preventDefault();lastCamera.zoom=Math.max(.75,Math.min(2,lastCamera.zoom+(e.deltaY>0?-.25:.25)));paint();},{passive:false});
let drag=null;host.addEventListener('pointerdown',e=>{if(e.button===1)drag=[e.clientX-lastCamera.x,e.clientY-lastCamera.y];});host.addEventListener('pointermove',e=>{if(drag){lastCamera.x=e.clientX-drag[0];lastCamera.y=e.clientY-drag[1];paint();}});window.addEventListener('pointerup',()=>drag=null);new ResizeObserver(()=>{app.renderer.resize(host.clientWidth,host.clientHeight);paint();}).observe(host);
globalThis.lab={set(options){playing=false;Object.assign(params,options);document.querySelector('#scenario').value=params.scenario;document.querySelector('#count').value=params.count;document.querySelector('#height').value=params.height;document.querySelector('#reduced').checked=params.reduced;return paint();},snapshot:()=>structuredClone(state),params:()=>({...params}),camera(options){Object.assign(lastCamera,options);return paint();},async benchmark(count,player='sampler',samples=180){params.count=count;params.player=player;const intervals=[],draw=[],start=performance.now();let prior;for(let i=0;i<samples+30;i++){await new Promise(requestAnimationFrame);const now=performance.now();if(prior!==undefined&&i>=30)intervals.push(now-prior);prior=now;params.time=(i*17)%8000;const before=performance.now();paint();if(i>=30)draw.push(performance.now()-before);}const stats=a=>{a.sort((x,y)=>x-y);return {p50:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],p99:a[Math.floor(a.length*.99)],max:a.at(-1)};};return {count,player,samples,elapsed_ms:performance.now()-start,frame_intervals_ms:stats(intervals),cpu_submit_ms:stats(draw),stalls_over_33ms:intervals.filter(v=>v>33.33).length};},rendererInfo(){const gl=app.renderer.gl,ext=gl?.getExtension('WEBGL_debug_renderer_info');return {type:app.renderer.type,vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,dpr:devicePixelRatio,userAgent:navigator.userAgent};}};
paint();globalThis.labReady=true;
