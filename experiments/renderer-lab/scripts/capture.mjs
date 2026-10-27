import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
await mkdir('evidence',{recursive:true});
await copyFile('node_modules/pixi.js/dist/pixi.min.js','web/pixi.min.js');
const root=resolve('.'),allowed=new Map([
  ['/', ['web/index.html','text/html']],['/style.css',['web/style.css','text/css']],
  ['/scene.mjs',['web/scene.mjs','text/javascript']],['/fixture.mjs',['web/fixture.mjs','text/javascript']],
  ['/pixi.min.js',['web/pixi.min.js','text/javascript']],['/assets/actors.png',['assets/actors.png','image/png']],
]);
const server=createServer(async(req,res)=>{const file=allowed.get(new URL(req.url,'http://127.0.0.1').pathname);if(!file){res.writeHead(404);res.end();return;}try{const bytes=await readFile(resolve(root,file[0]));res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(500);res.end('Artifact unavailable');}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const port=server.address().port,base=`http://127.0.0.1:${port}`;
let browser;
try {
  // Always headless: no visible browser or desktop switching, even on failure.
  browser=await chromium.launch({channel:'msedge',headless:true});
  const atlasPage=await browser.newPage({viewport:{width:240,height:140}});
  await atlasPage.setContent(await readFile('assets/actors.svg','utf8'));
  await atlasPage.locator('svg').screenshot({path:'assets/actors.png',omitBackground:true});
  await atlasPage.close();
  const page=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.waitForFunction(()=>globalThis.labReady,{timeout:15000});
  const atlasValidation=await page.evaluate(async()=>{const image=new Image();image.src='/assets/actors.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const bounds=[];for(let variant=0;variant<2;variant++)for(let frame=0;frame<6;frame++){const pixels=ctx.getImageData(frame*32,variant*48,32,48).data;let minX=32,minY=48,maxX=-1,maxY=-1;for(let y=0;y<48;y++)for(let x=0;x<32;x++)if(pixels[(y*32+x)*4+3]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}bounds.push({variant,frame,minX,minY,maxX,maxY});}return {width:image.width,height:image.height,anchor:[16,44],bounds};});
  assert.equal(atlasValidation.width,192);assert.equal(atlasValidation.height,96);assert.equal(atlasValidation.bounds.length,12);
  for(const frame of atlasValidation.bounds){assert.ok(frame.maxY<44);assert.ok(frame.minX>=0&&frame.maxX<32);}
  await writeFile('evidence/atlas-validation.json',JSON.stringify(atlasValidation,null,2));
  const shots=[];
  for(const shot of [
    ['01-idle',{time:0}],['02-approach',{time:2000}],['03-handoff',{time:3700}],['04-settled',{time:5200}],
    ['05-contact-lost',{time:5200,scenario:'stale'}],['06-cancelled',{time:5200,scenario:'cancelled'}],
    ['07-failure',{time:5200,scenario:'failure'}],['08-reduced-motion',{time:2000,scenario:'normal',reduced:true}],
    ['09-small-character',{time:3700,reduced:false,height:32}],['10-stress-100',{time:3700,count:100,height:48}],['12-twenty-actors',{time:3700,count:20}],
  ]) {
    const state=await page.evaluate(options=>lab.set({count:2,height:48,reduced:false,scenario:'normal',...options}),shot[1]);
    const file=`evidence/${shot[0]}.png`;await page.screenshot({path:file});shots.push({file,state});console.log(`Captured ${shot[0]}`);
  }
  for(const time of [0,1200,2000,3700,4200,5200]){
    await page.evaluate(time=>lab.set({time,count:2,scenario:'normal',player:'sampler'}),time);
    const samplerPng=await page.locator('canvas').screenshot();
    await page.evaluate(()=>lab.set({player:'library'}));
    const libraryPng=await page.locator('canvas').screenshot();
    assert.ok(samplerPng.equals(libraryPng),`Direct sampler and AnimatedSprite must draw identical pixels at ${time}`);
  }
  await page.evaluate(()=>lab.set({time:1000,reduced:true}));const still=await page.locator('canvas').screenshot();
  await page.evaluate(()=>lab.set({time:2000}));assert.ok(still.equals(await page.locator('canvas').screenshot()));
  await page.evaluate(()=>lab.set({reduced:false,scenario:'stale',time:2500}));const stale=await page.locator('canvas').screenshot();
  await page.evaluate(()=>lab.set({time:5200}));assert.ok(stale.equals(await page.locator('canvas').screenshot()));
  await page.evaluate(()=>lab.set({scenario:'normal'}));
  await page.evaluate(()=>lab.set({time:3700}));const before=await page.evaluate(()=>lab.snapshot());
  for(const time of [8000,0,2200,7000,3700])await page.evaluate(t=>lab.set({time:t}),time);
  assert.deepEqual(await page.evaluate(()=>lab.snapshot()),before);
  // Exercise actual controls and hit testing instead of checking labels alone.
  await page.locator('#scenario').selectOption('stale');await page.locator('#time').fill('5200');await page.locator('#time').dispatchEvent('input');
  assert.equal(await page.locator('#status').textContent(),'Running');assert.match(await page.locator('#coverage').textContent(),/unknown/);
  await page.locator('#reduced').check();assert.equal((await page.evaluate(()=>lab.snapshot())).reduced_motion,true);
  await page.locator('#scenario').selectOption('normal');await page.locator('#reduced').uncheck();
  await page.evaluate(()=>lab.set({time:3700,count:2}));
  const workerB=await page.evaluate(()=>{const c=document.querySelector('canvas').getBoundingClientRect();const w=document.querySelector('#world');const scale=Math.max(1,Math.floor(Math.min(w.clientWidth/304,w.clientHeight/224)));return {x:c.x+Math.floor((w.clientWidth-304*scale)/2)+253*scale,y:c.y+Math.floor((w.clientHeight-224*scale)/2)+(139-20)*scale};});
  await page.mouse.click(workerB.x,workerB.y);assert.equal(await page.locator('#selected').textContent(),'worker-b');
  await page.mouse.move(workerB.x,workerB.y);await page.mouse.wheel(0,-100);await page.screenshot({path:'evidence/11-selection-zoom.png'});
  await page.evaluate(()=>lab.camera({zoom:1,x:0,y:0}));
  for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:1920,height:1080}]){await page.setViewportSize(viewport);await page.screenshot({path:`evidence/size-${viewport.width}x${viewport.height}.png`});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:1280,height:800});
  for(const dpr of [1.25,1.5]){const dpiPage=await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:dpr});await dpiPage.goto(base);await dpiPage.waitForFunction(()=>globalThis.labReady);await dpiPage.evaluate(()=>lab.set({time:3700}));await dpiPage.screenshot({path:`evidence/dpr-${dpr}.png`});await dpiPage.close();}
  const reuse=process.argv.includes('--reuse-benchmarks');
  const benchmarks=reuse?JSON.parse(await readFile('evidence/browser-report.json','utf8')).benchmarks:[];
  if(!reuse)for(const count of [2,20,100])for(const player of ['sampler','library']){
    const result=await page.evaluate(async({count,player})=>lab.benchmark(count,player),{count,player});
    benchmarks.push(result);console.log(`Measured ${count} actors / ${player}: p95 ${result.frame_intervals_ms.p95.toFixed(2)} ms`);
  }
  await page.evaluate(()=>lab.set({time:5200,count:2,scenario:'normal'}));
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');const idleBefore=await cdp.send('Performance.getMetrics');await page.waitForTimeout(2000);const metrics=await cdp.send('Performance.getMetrics');
  const value=(data,name)=>data.metrics.find(v=>v.name===name)?.value;
  const idle={window_seconds:2,main_thread_task_seconds:value(metrics,'TaskDuration')-value(idleBefore,'TaskDuration'),js_heap_used_bytes:value(metrics,'JSHeapUsedSize'),note:'CDP main-thread tasks and JS heap only; not total browser/application CPU or memory'};
  const report={scope:'Headless native Windows Edge/PixiJS visual study; not a native Rust/Macroquad or Tauri/WebView2 benchmark',browser_version:browser.version(),renderer:await page.evaluate(()=>lab.rendererInfo()),benchmarks,benchmark_reused:reuse,metrics,idle,checks:{browser_errors:errors,atlas_valid:true,seek_deterministic:true,library_pixel_parity:true,selection:true,scenario_controls:true,resizing:true,reduced_motion_static:true,stale_static:true},shots};
  assert.deepEqual(errors,[]);await writeFile('evidence/browser-report.json',JSON.stringify(report,null,2));
  await writeFile('evidence/terminal.txt',await page.evaluate(()=>document.querySelector('#terminal').textContent));
  console.log('Browser study checks passed. Screenshots and browser-report.json saved.');
} finally {if(browser)await browser.close();await new Promise(done=>server.close(done));}
