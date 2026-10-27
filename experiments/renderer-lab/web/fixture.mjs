// Explicit synthetic records. This browser study does not run the Rust engine.
export const route=[[76,139],[116,139],[116,87],[225,87],[225,139]];
export const normalEvents=[
  {at:0,type:'node.ready',status:'Ready',phase:'idle'},
  {at:800,type:'node.running',status:'Running',phase:'walk'},
  {at:3500,type:'fixture.handoff',status:'Running',phase:'interact'},
  {at:4700,type:'node.succeeded',status:'Succeeded',phase:'settled'},
];
export function routeSample(progress) {
  const lengths=route.slice(1).map((p,i)=>Math.hypot(p[0]-route[i][0],p[1]-route[i][1]));
  let remain=Math.min(1,Math.max(0,progress))*lengths.reduce((a,b)=>a+b,0);
  for(let i=0;i<lengths.length;i++) {
    if(remain<=lengths[i]) {const a=route[i],b=route[i+1],f=remain/lengths[i];return {x:a[0]+(b[0]-a[0])*f,y:a[1]+(b[1]-a[1])*f,facing:b[0]<a[0]?'left':b[1]<a[1]?'up':b[1]>a[1]?'down':'right'};}
    remain-=lengths[i];
  }
  return {x:225,y:139,facing:'right'};
}
export function clipFrame(action,t,reduced=false) {
  if(reduced)return action==='interact'?4:0;
  return action==='walk'?2+Math.floor(t/140)%2:action==='interact'?(t%480<180?4:5):(t%800<600?0:1);
}
export function sampleScene(time,count=2,scenario='normal',reduced=false) {
  if(!Number.isFinite(time)||!Number.isInteger(count)||count<2||count>100||!['normal','stale','cancelled','failure'].includes(scenario))throw new Error('Invalid fixture parameters');
  const t=Math.max(0,Math.min(8000,Math.round(time))),interrupted=scenario!=='normal'&&t>=2200;
  const events=interrupted?[...normalEvents.filter(e=>e.at<2200),{at:2200,type:scenario==='stale'?'owner.contact_lost':`node.${scenario}`,status:scenario==='stale'?'Running':scenario==='failure'?'Failed':'Cancelled',phase:'interrupted'}]:normalEvents;
  const event=events.findLast(e=>e.at<=t),phase=event.phase,status=event.status;
  const position=routeSample(((interrupted?2200:t)-800)/2700);
  if(!interrupted&&t>=3500)position.facing='right';
  if(reduced&&!interrupted&&t>=800)Object.assign(position,{x:225,y:139,facing:'right'});
  const frozen=reduced||interrupted,action=['settled','interrupted'].includes(phase)?'idle':phase;
  const clipStart=phase==='walk'?800:phase==='interact'?3500:phase==='settled'?4700:0;
  const actors=[{id:'worker-a',...position,frame:clipFrame(action,Math.max(0,t-clipStart),frozen),variant:0,action:phase},
    {id:'worker-b',x:253,y:139,facing:'left',frame:phase==='interact'?5:clipFrame('idle',t,frozen),variant:1,action:phase==='interact'?'receive':'idle'}];
  for(let i=2;i<count;i++)actors.push({id:`fixture-${String(i).padStart(3,'0')}`,x:count<=20?32+((i-2)%9)*28:23+((i-2)%17)*16,y:count<=20?184+Math.floor((i-2)/9)*37:174+Math.floor((i-2)/17)*8,frame:clipFrame('idle',t+i*37,frozen),variant:i%2,facing:'right',action:'idle'});
  return {time_ms:t,phase,status,coverage:interrupted&&scenario==='stale'?'owner contact lost; outcome unknown':'fixture captured',scenario,reduced_motion:reduced,actors,event,events};
}
export function terminalProjection(scene) {
  return [`SIMULATION / REPLAY  ${String(scene.time_ms).padStart(4)} ms`,
    '  [A] worker-a  -- visit / review -->  [B] worker-b',
    `  action: ${scene.phase}   recorded status: ${scene.status}`,
    `  coverage: ${scene.coverage}`,
    '  evidence: fixture://review-01  (synthetic; no command executed)'].join('\n');
}
