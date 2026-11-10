import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as learning from '../dist/learning.js';
import * as theory from '../dist/theory.js';
import {BUILD_REVISION} from '../dist/build.js';
import {Scheduler,cleanLevels} from '../dist/scheduler.js';
import * as scoring from '../dist/scoring.js';
import * as judgment from '../dist/judgment.js';
import * as performance from '../dist/performance.js';
function session(extras={},connected=true){
 const nodes=new Map(),documentHandlers={},alerts=[];
 const element=()=>({open:false,click(){this.clicked=true;},showModal(){this.open=true;},close(){this.open=false;},style:{setProperty(key,value){this[key]=value;}},dataset:{},hidden:false,textContent:'',value:'',clientHeight:300,setAttribute(key,value){this.attributes??={};this.attributes[key]=value;},children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},queries:new Map(),querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,element());return this.queries.get(selector);},scrollLeft:0,scrollIntoView(){},setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){}});
 const get=id=>{if(!nodes.has(id)){const node=element();if(id==='performance-frost')node.clientHeight=96;nodes.set(id,node);}return nodes.get(id);};
 const context=vm.createContext({alert:message=>alerts.push(message),...theory,...learning,BUILD_REVISION,Scheduler,cleanLevels,...scoring,...judgment,...performance,now:0,document:{getElementById:get,createElement:element,addEventListener(type,fn){documentHandlers[type]=fn;}},localStorage:{getItem(key){return key==='voicing-stage'?'0':key==='voicing-bpm'?'60':null;},setItem(){}},performance:{now:()=>context.now},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame(){},...extras});
 vm.runInContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 // Legacy timeline fixtures use 90 BPM; mode entry tests exercise production defaults.
 vm.runInContext('bpm=90',context);
 if(!extras.localStorage)vm.runInContext('selectStage(5)',context);
 if(connected)vm.runInContext("midiInputs.set('fixture',{state:'connected'})",context);
 return {run:code=>vm.runInContext(code,context),nodes,documentHandlers,alerts};
}
test('pause excludes elapsed wall time, tempo changes preserve timer, restart resets',()=>{
 const {run,nodes}=session();run('play();now=10000;pause();now=70000;render(now)');assert.equal(nodes.get('training-time').textContent,'29:50');
 run('bpm=120;play();now=75000;render(now)');assert.equal(nodes.get('training-time').textContent,'29:45');
 run('reset()');assert.equal(nodes.get('training-time').textContent,'30:00');assert.equal(run('elapsed'),0);
});
test('screen wake lock is acquired for training and released on pause and completion',async()=>{
 const locks=[];
 const {run}=session({navigator:{wakeLock:{async request(type){
  assert.equal(type,'screen');const lock={released:false,async release(){this.released=true;},addEventListener(){}};locks.push(lock);return lock;
 }}}});
 run('play()');await new Promise(setImmediate);assert.equal(locks.length,1);
 run('pause()');assert.equal(locks[0].released,true);
 run('play()');await new Promise(setImmediate);assert.equal(locks.length,2);
 run('complete()');assert.equal(locks[1].released,true);
});
test('late wake lock requests are released after pausing',async()=>{
 let resolve;const lock={released:false,async release(){this.released=true;},addEventListener(){}};
 const {run}=session({navigator:{wakeLock:{request(){return new Promise(done=>{resolve=done;});}}}});
 run('play();pause()');resolve(lock);await new Promise(setImmediate);
 assert.equal(lock.released,true);assert.equal(run('screenLock'),null);
});
test('wake lock rejection does not interrupt training',async()=>{
 const {run}=session({navigator:{wakeLock:{async request(){throw new Error('Denied');}}}});
 run('play()');await new Promise(setImmediate);assert.equal(run('running'),true);assert.equal(run('screenLock'),null);
});



test('phone detection preserves tablet and desktop layouts, including desktop-style iPad UA',()=>{
 const cases=[
  {ua:'Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile',width:412,height:915,touch:5,coarse:true,phone:true},
  {ua:'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) Mobile',width:768,height:1024,touch:5,coarse:true,phone:false},
  {ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari',width:820,height:1180,touch:5,coarse:true,phone:false},
  {ua:'Mozilla/5.0 (Linux; Android 15; Tablet) Safari',width:800,height:1280,touch:5,coarse:true,phone:false},
  {ua:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari',width:1440,height:900,touch:0,coarse:false,phone:false},
  {ua:'',width:390,height:844,touch:5,coarse:true,phone:true},
  {ua:'',width:844,height:390,touch:5,coarse:true,phone:true},
  {ua:'',width:400,height:900,touch:0,coarse:false,phone:false}
 ];
 for(const c of cases){
  const {run,nodes}=session({navigator:{userAgent:c.ua,maxTouchPoints:c.touch},screen:{width:c.width,height:c.height},matchMedia:()=>({matches:c.coarse,addEventListener(){}})});
  assert.equal(nodes.get('instrument').dataset.phone,String(c.phone),c.ua);
  run('play()');
  assert.equal(nodes.get('keyboard').dataset.obscured,String(!c.phone),c.ua);
 }
});





function midiSession(extras={}){
 const input={id:'keyboard-a',name:'Test keyboard',state:'connected'};
 const access={inputs:new Map([[input.id,input]])};
 const app=session({isSecureContext:true,navigator:{async requestMIDIAccess(options){assert.equal(options.sysex,false);return access;}},...extras},false);
 return {...app,input,access,send:(data,port=input)=>port.onmidimessage({data:Uint8Array.from(data)})};
}
test('MIDI chords display while paused without changing the answer or training progress',async()=>{
 const {run,nodes,send}=midiSession();await run('connectMidi()');
 run('play();now=10000;pause()');
 const answer=run('JSON.stringify([...answerDots].filter(([,dot])=>!dot.hidden).map(([note])=>note))');
 send([0x90,60,100]);send([0x90,64,80]);send([0x90,67,90]);
 assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'true');
 assert.equal(run('midiKeys.get(64).dataset.midiPressed'),'true');
 assert.equal(run('running'),false);assert.equal(run('sessionSeconds'),10);
 assert.equal(run('JSON.stringify([...answerDots].filter(([,dot])=>!dot.hidden).map(([note])=>note))'),answer);
 send([0x80,60,64]);send([0x90,64,0]);
 assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'false');
 assert.equal(run('midiKeys.get(64).dataset.midiPressed'),'false');
 send([0xb0,64,127]);send([0x80,67,0]);
 assert.equal(run('midiKeys.get(67).dataset.midiPressed'),'false');
 assert.equal(run('midiKeys.get(67).dataset.midiSustained'),'true');send([0xb0,64,0]);assert.equal(run('midiKeys.get(67).dataset.midiSustained'),'false');
 send([0xf8]);send([0x90,60]);assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'false');
});
test('MIDI tracks overlapping devices/channels and clears disconnected inputs and background keys',async()=>{
 const {run,send,input,access,documentHandlers}=midiSession();await run('connectMidi()');
 const second={id:'keyboard-b',name:'Second',state:'connected'};
 access.inputs.set(second.id,second);access.onstatechange();
 send([0x90,60,100]);send([0x91,60,100]);send([0x90,60,100],second);
 send([0x80,60,0]);send([0xb1,123,0]);
 assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'true');
 second.state='disconnected';access.onstatechange();
 assert.equal(second.onmidimessage,null);assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'false');
 send([0x90,61,100]);run('play();pause()');assert.equal(run('midiKeys.get(61).dataset.midiPressed'),'true');
 run('document.hidden=true');documentHandlers.visibilitychange();
 assert.equal(run('midiKeys.get(61).dataset.midiPressed'),'false');
 send([0x90,60,100]);assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'false');
 run('document.hidden=false');send([0x90,62,100]);send([0xb0,120,0]);
 assert.equal(run('midiKeys.get(62).dataset.midiPressed'),'false');
 input.state='disconnected';access.onstatechange();assert.equal(run('midiInputs.size'),0);
 input.state='connected';access.onstatechange();send([0x90,63,100]);
 assert.equal(run('midiKeys.get(63).dataset.midiPressed'),'true');
 run('clearMidi()');assert.equal(run('midiKeys.get(63).dataset.midiPressed'),'false');
});
test('MIDI capability and permission failures block training and stay recoverable',async()=>{
 for(const extras of [{isSecureContext:false},{navigator:{}},{navigator:{async requestMIDIAccess(){throw Object.assign(new Error(),{name:'NotAllowedError'});}}}]){
  const {run,nodes}=midiSession(extras);await run('connectMidi()');
  assert.match(nodes.get('midi-status').textContent,/HTTPS|未提供|未获允许/);
  assert.notEqual(nodes.get('midi-connect').disabled,true);
  run('play()');assert.equal(run('running'),false);
 }
 const {run,nodes}=midiSession();
 await new Promise(setImmediate);
 run("navigator.requestMIDIAccess=async()=>{throw new Error('unavailable')}");await run('connectMidi()');
 assert.match(nodes.get('midi-status').textContent,/无法连接/);
 run('navigator.requestMIDIAccess=async()=>({inputs:new Map()})');await run('connectMidi()');
 assert.match(nodes.get('midi-status').textContent,/未发现/);
});
test('MIDI capability works on phone and iPad browser identities and connection clicks do not resume',async()=>{
 for(const userAgent of ['iPhone','iPad','Macintosh Safari']){
  const input={id:'browser-test',state:'connected'};
  const access={inputs:new Map([[input.id,input]])};
  const {run,nodes}=session({isSecureContext:true,navigator:{userAgent,async requestMIDIAccess(){return access;}}});
  let stopped=false;nodes.get('midi-connect').handlers.click({stopPropagation(){stopped=true;}});
  await new Promise(setImmediate);assert.equal(stopped,true);assert.equal(typeof access.onstatechange,'function');
  input.onmidimessage({data:[0x90,60,100]});
  assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'true');assert.equal(run('running'),false);
 }
});

test('unplayed labels stay opaque until bottom contact before fading',()=>{
 const {run}=session();run('play();now=5500;render(now)');
 assert.equal(run('elements[0].style.opacity'),'1');
 run('now=7999;render(now)');assert.equal(run('elements[0].style.opacity'),'1');
 assert.equal(run('cards[0].feedback'),'wrong');
 run('now=8000;render(now)');assert.equal(run('elements[0].hidden'),false);
 run('now=8200;render(now)');assert.equal(run('elements[0].hidden'),true);
 assert.equal(run('elements[1].style.opacity'),'1');
});

test('automatic connection waits for an input; manual retry enables training without starting it',async()=>{
 let resolveAccess;
 const access={inputs:new Map()};
 const {run,nodes,alerts}=session({navigator:{requestMIDIAccess(){return new Promise(resolve=>{resolveAccess=resolve;});}}},false);
 assert.equal(typeof resolveAccess,'function');
 run('play()');assert.equal(run('running'),false);run("$('midi-warning').close()");
 resolveAccess(access);await new Promise(setImmediate);
 run('play()');assert.equal(run('running'),false);run("$('midi-warning').close()");
 nodes.get('midi-connect').handlers.click({stopPropagation(){}});
 access.inputs.set('keyboard',{id:'keyboard',state:'connected'});
 resolveAccess(access);await new Promise(setImmediate);
 assert.equal(run('running'),false);
 run('play()');assert.equal(run('running'),true);assert.equal(alerts.length,0);
});



test('repeated dismissed MIDI prompts cannot bypass any start entry or create results',()=>{
 const {run,nodes,documentHandlers,alerts}=session({},false);
 const entries=[()=>run('play()'),()=>nodes.get('overlay-action').handlers.click({stopPropagation(){}}),()=>documentHandlers.keydown({code:'Space',preventDefault(){}})];
 for(let i=0;i<30;i++){
  entries[i%entries.length]();
  assert.equal(nodes.get('midi-warning').open,true);
  assert.equal(run('running'),false);assert.equal(run('run.started'),false);
  assert.equal(run('Object.keys(results).length'),0);assert.equal(run('typeof timingRuns'),'undefined');
  nodes.get('midi-warning-close').handlers.click({stopPropagation(){}});
  documentHandlers.click();assert.equal(run('running'),false);
 }
 run('complete()');assert.equal(run('Object.keys(results).length'),0);assert.equal(alerts.length,0);
});
test('mouse drag scrolls without selecting; click and keyboard activation still select',()=>{
 const {run,nodes}=session();const route=nodes.get('route-surface');
 route.handlers.pointerdown({pointerType:'mouse',button:0,pointerId:1,clientX:300});route.handlers.pointermove({pointerId:1,clientX:100,preventDefault(){}});route.handlers.pointerup({pointerId:1});
 assert.equal(nodes.get('route-second').scrollLeft,200);let prevented=false;route.handlers.click({detail:1,preventDefault(){prevented=true;},stopPropagation(){}});assert.equal(prevented,true);
 run('routeNodes[1].handlers.click()');assert.equal(run('stageIndex'),1);
});

test('empty MIDI discovery never authorizes startup',()=>{
 const {run}=session({},false);run('midiAccess={inputs:new Map()};syncMidiInputs();play()');
 assert.equal(run('running'),false);assert.equal(run('started'),false);
});
test('only explicitly connected input states authorize startup',()=>{
 for(const state of ['disconnected','pending','closed',undefined]){
  const {run}=session({},false);run(`midiInputs.set('stale',{state:${JSON.stringify(state)}});play()`);
  assert.equal(run('running'),false);assert.equal(run('started'),false);
 }
});
test('disconnect blocks every resume entry until a device reconnects',async()=>{
 const {run,nodes,documentHandlers,input,access}=midiSession();await run('connectMidi()');
 run('play();now=10000;render(now)');input.state='disconnected';access.onstatechange();
 assert.equal(run('running'),false);const seconds=run('sessionSeconds');
 for(let i=0;i<12;i++){
  run('play()');assert.equal(nodes.get('midi-warning').open,true);assert.equal(run('running'),false);
  nodes.get('midi-warning-close').handlers.click({stopPropagation(){}});
  documentHandlers.click();assert.equal(run('running'),false);
  nodes.get('midi-warning-close').handlers.click({stopPropagation(){}});
  documentHandlers.keydown({code:'Space',preventDefault(){}});assert.equal(run('running'),false);
  nodes.get('midi-warning-close').handlers.click({stopPropagation(){}});
 }
 assert.equal(run('sessionSeconds'),seconds);
 input.state='connected';access.onstatechange();assert.equal(run('running'),false);
 run('play()');assert.equal(run('running'),true);
});

test('navigation keeps the continuous chain and distant leaves remain free',()=>{
 const {run,nodes}=session({localStorage:{getItem(){return null;},setItem(){}}});
 assert.equal(run('stageIndex'),0);assert.equal(run('expandedTop'),'project-notes');
 run("selectNode('level-6-v2');play()");assert.ok(run('stageIndex')>=0);assert.equal(run('started'),true);assert.equal(nodes.get('overlay-action').disabled,false);run('complete()');
 run("selectNode('quality-8')");assert.equal(run('expandedQuality'),'quality-8');assert.equal(nodes.get('route-third').children.length,4);
 run("selectNode('chord-8-3');play()");assert.equal(run('started'),true);assert.equal(run('cards[0].targets.length'),4);
 run("complete();selectNode('level-6-v2')");assert.equal(nodes.get('route-second').children.length,30);assert.equal(nodes.get('route-third').hidden,true);
});
test('eligible parent mixes only its own children and receives independent results',()=>{
 const {run,nodes}=session();
 run("for(const child of curriculum[0].children.slice(0,4))results[child.id]={best:{stars:3}};selectNode('notes-all')");
 assert.equal(nodes.get('overlay-action').disabled,false);assert.equal(run('scheduler.items.length'),17);
 run('play();complete()');assert.equal(run("results['notes-all'].best.stars"),0);assert.equal(run("results['notes-two'].best.stars"),3);
});
test('tail cards must touch strictly before the deadline at every tempo',()=>{
 for(const bpm of [40,60,90,120,140]){
  const {run}=session();run(`bpm=${bpm};play();now=1780000;render(now)`);
  for(let ms=1780100;ms<1800000;ms+=100){
   run(`now=${ms};render(now)`);
   assert.equal(run('cards.every((c,i)=>sessionSeconds+(i+2-elapsed)*240/bpm<MAX_SECONDS-1e-9)'),true);
  }
  run('now=1800000;render(now)');assert.equal(run('finished'),false);
  run('now=1820000;render(now)');assert.equal(run('finished'),true);
 }
});
test('result stars preserve half-star ratings without a numerical score',()=>{
 const {run,nodes}=session();run('showResult({stars:2.5,total:10,correct:8,accuracy:.8,seconds:300,factors:{pause:1,keyboard:1,speed:1,duration:1}})');
 assert.equal(nodes.get('result-stars').children[1].style.width,`${2.5/3*100}%`);
 assert.equal(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').includes('id="result-score"'),false);
});

test('project browsing preserves selected training and expanded inversions',()=>{
 const {run,nodes}=session();run("selectNode('chord-0-1');selectNode('project-colors')");
 assert.equal(run("stages[stageIndex].id"),'chord-0-1');assert.equal(run('expandedQuality'),'quality-0');
 assert.equal(run('expandedTop'),'project-colors');assert.equal(nodes.get('route-second').children.length,30);
 assert.equal(nodes.get('route-third').children.length,3);
});
test('scroll project tracking uses center and endpoints without selecting training',()=>{
 const {run,nodes}=session();
 const row=nodes.get('route-second');row.clientWidth=400;row.scrollWidth=2200;
 row.getBoundingClientRect=()=>({left:0,right:400,width:400});
 row.children.forEach((node,i)=>{node.getBoundingClientRect=()=>({left:i*120-row.scrollLeft,right:i*120+100-row.scrollLeft});});
 row.scrollLeft=1250;run('syncProjectFromScroll()');assert.equal(run('expandedTop'),'project-colors');
 row.scrollLeft=1800;run('syncProjectFromScroll()');assert.equal(run('expandedTop'),'project-extended');
 row.scrollLeft=0;run('syncProjectFromScroll()');assert.equal(run('expandedTop'),'project-notes');
 assert.equal(run("stages[stageIndex].id"),'chord-0-1');
});

test('programmatic end-of-chain navigation keeps the clicked project highlighted',()=>{
 const {run,nodes}=session();
 const row=nodes.get('route-second');row.scrollLeft=1800;row.clientWidth=400;row.scrollWidth=2200;
 row.getBoundingClientRect=()=>({left:0,right:400,width:400});
 run("selectNode('project-colors');syncProjectFromScroll()");
 assert.equal(run('expandedTop'),'project-colors');
 assert.equal(run("stages[stageIndex].id"),'chord-0-1');
});

test('training header names stages and tracks active time through pause, resume and restart',()=>{
 const {run,nodes}=session();assert.equal(nodes.get('training-header').hidden,true);
 for(const [id,name] of [['chord-10-3','大六和弦-根音左二'],['level-4-v2','Level-4色彩和弦'],['quality-8','加九和弦']]){
  run(`selectNode('${id}');play()`);
  assert.equal(nodes.get('training-name').textContent,name);
  assert.equal(nodes.get('training-header').hidden,false);
  run('complete();reset()');
 }
 run('now=0;play();now=123456;pause()');
 assert.equal(nodes.get('training-time').textContent,'27:57');
 assert.equal(nodes.get('training-header').hidden,false);
 run('now=500000;render(now)');assert.equal(nodes.get('training-time').textContent,'27:57');
 run('play();now=501000;render(now)');assert.equal(nodes.get('training-time').textContent,'27:56');
 run('complete()');assert.equal(nodes.get('training-header').hidden,true);
 run('reset();play()');assert.equal(nodes.get('training-time').textContent,'30:00');
});


test('practice availability follows the selected node and challenge remains available',()=>{
 const {run,nodes}=session();
 for(const id of ['level-2','level-6-v2']){
  run(`selectNode('${id}')`);assert.equal(nodes.get('practice-action').hidden,true);
  assert.equal(nodes.get('overlay-action').disabled,false);
  run("startMode('practice')");assert.equal(run('started'),false);
 }
 for(const id of ['notes-two','notes-all','quality-0','chord-10-3','quality-11']){
  run(`selectNode('${id}')`);assert.equal(nodes.get('practice-action').hidden,false);
  nodes.get('practice-action').handlers.click({stopPropagation(){}});
  assert.equal(run('mode'),'practice');assert.ok(run('Number.isInteger(cards[0].pc)&&cards[0].pc>=0&&cards[0].pc<12'));
  run('complete()');assert.equal(nodes.get('result-dialog').open,false);
 }
});

test('manual pause does not rewind practice or count paused time',()=>{
 const {run}=session();run("startMode('practice');now=9000;pause()");
 const progress=run('elapsed');run('now=100000;play()');assert.equal(run('elapsed'),progress);
 assert.equal(run('sessionSeconds'),9);
 run('now=101000;render(now)');assert.equal(run('sessionSeconds'),10);
});

test('expanded route surface handles touch dragging and wheel without starting a mode',()=>{
 const {run,nodes}=session(),surface=nodes.get('route-surface'),row=nodes.get('route-second');
 surface.handlers.pointerdown({pointerType:'touch',pointerId:3,clientX:300});
 surface.handlers.pointermove({pointerId:3,clientX:100,preventDefault(){}});
 surface.handlers.pointerup({pointerId:3});assert.equal(row.scrollLeft,200);
 surface.handlers.wheel({deltaX:0,deltaY:40,deltaMode:0,preventDefault(){}});assert.equal(row.scrollLeft,240);
 assert.equal(run('started'),false);
});

test('dragging reverses immediately after reaching the chain edge and capture loss cancels movement',()=>{
 const {run,nodes}=session(),surface=nodes.get('route-surface'),row=nodes.get('route-second');
 let scroll=0;Object.defineProperty(row,'scrollLeft',{get:()=>scroll,set:value=>{scroll=Math.max(0,Math.min(100,value));}});
 run("selectNode('quality-10')");
 const selected=run('stageIndex');
 surface.handlers.pointerdown({pointerType:'touch',pointerId:5,clientX:300});
 surface.handlers.pointermove({pointerId:5,clientX:0,preventDefault(){}});assert.equal(scroll,100);
 surface.handlers.pointermove({pointerId:5,clientX:20,preventDefault(){}});assert.equal(scroll,80);
 surface.handlers.lostpointercapture({pointerId:5,target:surface});
 surface.handlers.pointermove({pointerId:5,clientX:40,preventDefault(){}});assert.equal(scroll,80);
 assert.equal(run('stageIndex'),selected);assert.equal(run('expandedQuality'),'quality-10');
});


test('touch capture transferred from a chord or inversion button keeps the drag alive',()=>{
 for(const id of ['quality-10','chord-10-3']){
  const {run,nodes}=session(),surface=nodes.get('route-surface'),row=nodes.get('route-second');
  run(`selectNode('${id}')`);
  const button=run(`stageButtons.get('${id}')`),selected=run('stageIndex');
  surface.handlers.pointerdown({pointerType:'touch',pointerId:8,clientX:300,target:button});
  surface.handlers.pointermove({pointerId:8,clientX:290,preventDefault(){}});
  assert.equal(row.scrollLeft,10);
  // Mobile browsers implicitly capture the finger on the button first.
  // Its loss event bubbles when the scroll surface takes over capture.
  surface.handlers.lostpointercapture({pointerId:8,target:button});
  surface.handlers.pointermove({pointerId:8,clientX:200,preventDefault(){}});
  assert.equal(row.scrollLeft,100);
  surface.handlers.pointermove({pointerId:8,clientX:100,preventDefault(){}});
  assert.equal(row.scrollLeft,200);assert.equal(run('stageIndex'),selected);
  surface.handlers.pointerup({pointerId:8,target:surface});
  assert.equal(run('routeDrag'),null);
 }
});

test('challenge is fixed at 120 BPM and settings stay unavailable until exit',()=>{
 const {run,nodes}=session();
 run("practiceSettings.bpm=40;startMode('challenge');now=6000;pause()");
 assert.equal(run('bpm'),120);
 assert.equal(nodes.get('pause-settings').hidden,true);
 run('openSettings()');assert.equal(nodes.get('settings-dialog').open,false);
 nodes.get('bpm-decrease').handlers.click({stopPropagation(){}});
 assert.equal(run('bpm'),120);assert.equal(run('practiceSettings.bpm'),40);
 nodes.get('metronome').handlers.click({stopPropagation(){}});
 run('now=66000;play()');assert.equal(run('bpm'),120);
 run("complete();$('result-dialog').close();startMode('practice');pause()");
 assert.equal(run('bpm'),40);assert.equal(nodes.get('pause-settings').hidden,false);
});
test('challenge settles before B touches and fades in place only after bottom contact',()=>{
 const {run}=session();run('play();now=7950;render(now)');
 assert.equal(run('run.total'),1);assert.equal(run('elements[0].style.opacity'),'1');
 run('now=8000;render(now)');assert.equal(run('elements[0].style.transform'),'translateY(264px)');
 run('now=8090;render(now)');assert.ok(Math.abs(run('Number(elements[0].style.opacity)')-.5)<1e-8);
 assert.equal(run('elements[0].style.transform'),'translateY(264px)');
 run('now=8190;render(now)');assert.equal(run('elements[0].hidden'),true);
});

test('challenge errors remain sticky until the next early window and never affect the previous card',()=>{
 const {run}=session();run('play();now=5500;for(const n of cards[0].targets)judgeMidi(n);now=7900;judgeMidi(1);now=7950;render(now)');
 assert.equal(run('run.correct'),0);assert.equal(run('cards[0].feedback'),'wrong');
 run('judgeMidi(1)');assert.equal(run('cards[1].wrong'),true);assert.equal(run('run.total'),1);
});

test('exit settles only the current question, including silence and incomplete chords',()=>{
 for(const kind of ['silent','partial','correct','wrong']){
  const {run}=session();run('play();now=5500;render(now)');
  if(kind==='partial')run('judgeMidi(cards[0].targets[0])');
  if(kind==='correct'||kind==='wrong')run('for(const n of cards[0].targets)judgeMidi(n)');
  if(kind==='wrong')run('judgeMidi(1)');
  run('pause();complete()');assert.equal(run('run.total'),1);assert.equal(run('run.correct'),kind==='correct'?1:0);
 }
});
test('repeated errors never terminate challenge early or create a failure score',()=>{
 const {run}=session();run('play();now=100000;render(now)');
 assert.equal(run('finished'),false);assert.ok(run('run.total')>8);
 assert.equal(run("'failed' in run"),false);
 run('now=1800000;render(now)');assert.equal(run('finished'),false);
  run('now=1820000;render(now)');assert.equal(run('finished'),true);assert.equal(run('run.seconds'),1800);
});



test('full thirty minutes with correct MIDI answers finishes and awards three stars',()=>{
 const {run,nodes}=session();run(`play();for(let i=0;i<673;i++){now=(i+2)*240000/90+1;render(now);for(const n of cards[i].targets)judgeMidi(n);}now=1800000;render(now)`);
 assert.equal(run('finished'),false);
 run('now=1810000;render(now)');
 assert.equal(run('finished'),true);assert.equal(run('run.seconds'),1800);
 assert.equal(run('calculateScore(run).stars'),3);assert.equal(nodes.get('training-time').textContent,'00:00');
});
test('only final best stars persist; performance recording is removed',()=>{
 const writes=new Map();const {run,nodes}=session({localStorage:{getItem(){return null;},setItem(k,v){writes.set(k,v);}}});
 run('practiceSettings.metronomeOn=false');
 run('play();now=5500;for(const n of cards[0].targets)judgeMidi(n);pause();complete()');
 assert.deepEqual([...writes.keys()],['voicing-stars']);const saved=JSON.parse(writes.get('voicing-stars'));
 assert.ok(Object.values(saved).every(x=>typeof x==='number'));
 const restored=session({localStorage:{getItem(k){return k==='voicing-stars'?JSON.stringify(saved):null;},setItem(){}}});
 assert.equal(restored.run('bpm'),90);assert.equal(restored.run('typeof timingRuns'),'undefined');
});
test('removed mistake block rules leave no shipped UI or score failure branch',()=>{
 for(const file of ['app.js','style.css','index.html','scoring.js'])assert.doesNotMatch(readFileSync(new URL('../dist/'+file,import.meta.url),'utf8'),/mistakeStacks|mistake-block|run\.failed|堆叠触线/);
});

test('pausing freezes all cards and ignores MIDI; exit settles the active attempt',()=>{
 const {run,nodes}=session();run('play();now=6000;pause();const position=elements[0].style.transform');
 run('now=60000;for(const n of cards[0].targets)judgeMidi(n);render(now)');
 assert.equal(run('elements[0].style.transform'),run('position'));assert.equal(run('cards[0].hits.size'),0);
 assert.equal(nodes.get('pause-screen').hidden,false);
 run('complete()');assert.equal(run('run.total'),1);
});

test('zero-star home ratings are blank and do not replace previously earned stars',()=>{
 const {run}=session();run('play();results[stages[stageIndex].id]={best:{stars:2.5}};complete()');
 assert.equal(run('results[stages[stageIndex].id].best.stars'),2.5);
 run("$('result-dialog').close();play();complete()");assert.equal(run('results[stages[stageIndex].id].best.stars'),2.5);
});


test('practice uses challenge scheduling, cadence and keyboard-free layout without input feedback',()=>{
 for(const userAgent of ['iPhone','iPad','Macintosh']){
  const {run,nodes}=session({navigator:{userAgent}});run("startMode('practice')");
  assert.equal(run('scheduler instanceof Scheduler'),true);
  assert.equal(run('metronomeOn'),false);assert.equal(run('bpm'),90);
  assert.equal(nodes.get('instrument').dataset.performance,'true');
  assert.equal(nodes.get('keyboard-frost').hidden,true);
  assert.equal(nodes.get('instrument').dataset.hideKeys,'false');
  assert.equal(nodes.get('instrument').dataset.midiFeedback,'false');
  assert.equal(run('elements[0].style.transform'),'translateY(-44px)');
  run('now=240000/90;render(now)');
  assert.equal(run('cards.length'),2);assert.equal(run('elements[0].style.transform'),'translateY(62px)');
  assert.equal(run('elements[1].style.transform'),'translateY(-44px)');
  run('now=480000/90;render(now)');
  assert.equal(run('cards.length'),3);assert.equal(run('elements[0].style.transform'),'translateY(168px)');
  assert.equal(run('elements[1].style.transform'),'translateY(62px)');
  assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
  run('pause()');assert.equal(nodes.get('instrument').dataset.midiFeedback,'false');
 }
});
test('silent practice passes the entry line then freezes indefinitely at the bottom',()=>{
 const {run,nodes}=session();run("startMode('practice');now=6000;render(now)");assert.ok(run('elapsed')>2);
 run('now=16000;render(now);const positions=elements.map(e=>e.style.transform);now=7200000;render(now)');
 assert.equal(run('elapsed'),3);assert.equal(run('JSON.stringify(elements.map(e=>e.style.transform))===JSON.stringify(positions)'),true);
 assert.equal(nodes.get('training-time').textContent,'120:00');assert.equal(run('run.total'),0);
});

test('practice correct answers can become wrong and recover during the full measure',()=>{
 const {run}=session();run("startMode('practice');now=6000;render(now);cards[0].targets=[60,64,67];for(const n of cards[0].targets)judgeMidi(n)");
 assert.equal(run('isCorrect(cards[0])'),true);
 run('judgeMidi(1)');assert.equal(run('elements[0].dataset.feedback'),'wrong');
 run('judgeMidi(60);judgeMidi(64)');assert.equal(run('isCorrect(cards[0])'),false);
 run('judgeMidi(67)');assert.equal(run('elements[0].dataset.feedback'),'correct');
 run('now=8100;render(now)');assert.ok(run('elapsed')>3);assert.equal(run('cards[0].practicePassed'),true);
});

test('failed A retries once, fades red and releases B after a full count-in',()=>{
 for(const bpm of [40,90,137,180]){
  const {run}=session();run(`startMode('practice');bpm=${bpm};now=2.5*240000/bpm;render(now);cards[0].targets=[60,64,67];cards[1].targets=[62,65,69];judgeMidi(60);now=(3-1/32)*240000/bpm;render(now)`);
  run('for(const n of cards[0].targets)judgeMidi(n);for(const n of cards[1].targets)judgeMidi(n)');
  assert.equal(run('cards[0].hits.size'),1);assert.equal(run('cards[1].hits.size'),0);
  run('now=3*240000/bpm;render(now);for(const n of cards[1].targets)judgeMidi(n)');
  assert.equal(run('cards[1].hits.size'),0);
  run('for(const n of cards[0].targets)judgeMidi(n);const retryAt=now');
  assert.equal(run('cards[0].retryBeats'),0);
  assert.equal(run('elements[0].dataset.feedback'),'wrong');
  run('judgeMidi(1);now+=90;render(now)');
  assert.ok(Math.abs(run('Number(elements[0].style.opacity)')-.5)<1e-8);
  assert.equal(run('elapsed'),3);
  run('now=retryAt+3.875*60000/bpm-1;render(now);for(const n of cards[1].targets)judgeMidi(n)');
  assert.equal(run('cards[1].hits.size'),0);
  run('now+=1;render(now);for(const n of cards[1].targets)judgeMidi(n)');
  assert.equal(run('isCorrect(cards[1])'),true);
  assert.equal(run('elements[0].hidden'),true);
  run('now=retryAt+4*60000/bpm;render(now)');
  assert.equal(run('cards[0].practicePassed'),true);
  assert.equal(run('elapsed'),3);
  assert.equal(run('strikeFlashAt'),run('sessionSeconds'));
  run('now+=100;render(now)');assert.ok(run('elapsed')>3);
  run('now=retryAt+8*60000/bpm;render(now)');
  assert.equal(run('cards[1].practicePassed'),true);
 }
});

test('both modes share early input ownership and uninterrupted motion when practice answers are early',()=>{
 for(const bpm of [90,137,180])for(const mode of ['practice','challenge']){
  const {run}=session();run(`startMode('${mode}');bpm=${bpm};now=(2-1/32)*240000/bpm-1;render(now);cards[0].targets=[60,64,67]`);
  run('judgeMidi(60)');assert.equal(run('cards[0].hits.size'),0);
  run('now+=1;for(const n of cards[0].targets)judgeMidi(n)');assert.equal(run('cards[0].hits.size'),3);
  run('now=2*240000/bpm;render(now)');assert.equal(run('elapsed'),2);
  run('now=(3-1/32)*240000/bpm;render(now);cards[1].targets=[62,65,69];for(const n of cards[1].targets)judgeMidi(n)');
  assert.equal(run('cards[0].wrong'),false);assert.equal(run('cards[1].hits.size'),3);
  run('now=3.5*240000/bpm;render(now)');assert.ok(Math.abs(run('elapsed')-3.5)<1e-8);
 }
});
test('practice recognition requires fresh attacks and ignores sustained notes',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run("startMode('practice');now=6000;render(now);cards[0].targets=[60,64,67]");
 send([0x90,61,100]);for(const n of [60,64,67])send([0x90,n,100]);
 assert.equal(run('isCorrect(cards[0])'),false);
 send([0x80,61,0]);send([0x90,67,100]);assert.equal(run('isCorrect(cards[0])'),false);
 send([0x80,67,0]);send([0x90,67,100]);assert.equal(run('isCorrect(cards[0])'),true);
 send([0x90,61,100]);assert.equal(run('isCorrect(cards[0])'),false);
});
test('practice manual pause clears partial attacks but preserves solved passage',()=>{
 const {run,nodes}=session();run("startMode('practice');now=6000;render(now);judgeMidi(cards[0].targets[0]);pause()");
 assert.equal(nodes.get('instrument').dataset.paused,'true');assert.equal(run('cards[0].hits.size'),0);
 run('play();for(const n of cards[0].targets)judgeMidi(n);pause();now=60000;render(now)');assert.equal(run('elapsed'),2.25);
 run('play();now+=1000;render(now)');assert.ok(run('elapsed')>2);assert.equal(run('isCorrect(cards[0])'),true);
 assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
});

test('learning replaces free play, works without MIDI and keeps answers after release and errors',async()=>{
 const {run,nodes,send}=midiSession();await run('connectMidi()');
 run("selectNode('quality-5');startLearning()");
 assert.equal(run('learningActive'),true);assert.equal(run('running'),false);
 assert.equal(nodes.get('instrument').dataset.midiFeedback,'true');
 for(const n of [51,55,58,60]){send([0x90,n,100]);send([0x80,n,0]);}
 assert.equal(run('learningState.pc'),0);assert.equal(run('learningState.inv'),1);
 assert.equal(nodes.get('learning-name').textContent,'第一转位');
 assert.equal(run('[...answerDots.values()].filter(d=>!d.hidden).length'),4);
 send([0x90,61,100]);assert.equal(run('midiKeys.get(61).dataset.midiPressed'),'true');
 assert.equal(run('learningState.inv'),1);
 run('now=3600000;render(now)');assert.equal(run('learningState.inv'),1);
 nodes.get('learning-back').handlers.click();assert.equal(run('learningActive'),false);
 assert.equal(nodes.get('overlay').hidden,false);assert.equal(run('Object.keys(results).length'),0);
 const offline=session({},false);offline.run("selectNode('chord-0-2');startLearning()");
 assert.equal(offline.run('learningState.inv'),2);assert.equal(offline.nodes.get('midi-warning').open,false);
});
test('learning entry is hidden for notes and comprehensive levels and manual choice resets recognition',()=>{
 const {run,nodes}=session({},false);
 for(const id of ['notes-two','notes-all','level-2']){run(`selectNode('${id}');startLearning()`);assert.equal(run('learningActive'),false);assert.equal(nodes.get('free-action').hidden,true);}
 run("selectNode('quality-0');startLearning();judgeMidi(60);judgeMidi(64)");
 nodes.get('learning-positions').children[1].handlers.click();
 assert.equal(run('learningState.inv'),2);
 run('judgeMidi(67)');assert.equal(run('learningState.inv'),2);
 assert.equal(run('recognizer.candidates[0].hits.size'),1);
});
test('every single-note stage shares full-window practice and bottom retry behavior',()=>{
 for(const id of ['notes-two','notes-three','notes-black','notes-white','notes-all']){
  const {run,nodes}=session();run(`selectNode('${id}');startMode('practice');now=8000;render(now)`);
  assert.equal(run('elapsed'),3);assert.equal(run('cards.every(c=>c.targets.length===1)'),true);
  run('judgeMidi(cards[0].root)');assert.equal(run('cards[0].practicePassed'),false);
  run('judgeMidi(cards[1].root);now+=240000/bpm+100;render(now);pause()');assert.ok(run('elapsed')>3);
  assert.equal(nodes.get('instrument').dataset.paused,'true');assert.equal(run('run.total'),0);
 }
});

test('sustain follows each device and channel, clears on reset/disconnect, and does not judge released keys',async()=>{
 const {run,send,input,access}=midiSession();await run('connectMidi()');run("startMode('practice')");
 send([0xb0,64,127]);send([0x90,60,100]);send([0x80,60,0]);
 assert.equal(run('midiKeys.get(60).dataset.midiSustained'),'true');assert.equal(run("midiHeld.get('keyboard-a').get(0).size"),0);
 send([0x91,60,100]);send([0xb0,64,0]);assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'true');
 send([0x81,60,0]);assert.equal(run('midiKeys.get(60).dataset.midiPressed'),'false');
 send([0xb0,64,127]);send([0x90,62,100]);send([0x80,62,0]);send([0xb0,121,0]);
 assert.equal(run('midiKeys.get(62).dataset.midiSustained'),'false');
 send([0xb0,64,127]);send([0x90,64,100]);send([0x80,64,0]);input.state='disconnected';access.onstatechange();
 assert.equal(run('midiKeys.get(64).dataset.midiSustained'),'false');
});
test('settings include BPM, metronome, MIDI refresh and close without a timing recorder',()=>{
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const settings=html.split('<dialog id="settings-dialog"')[1].split('</dialog>')[0];
 assert.deepEqual([...settings.matchAll(/<button id="([^"]+)"/g)].map(m=>m[1]),['bpm-decrease','bpm-increase','metronome','midi-connect','settings-close']);
 const app=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/recordTimingAttack|createTimingRun|timing-export/);
});



test('practice tempo buttons step by ten, clamp at both ends and preserve the choice',()=>{
 const {run,nodes}=session();run("openSettings()");
 const click=id=>nodes.get(id).handlers.click({stopPropagation(){}});
 for(let i=0;i<8;i++)click('bpm-decrease');
 assert.equal(run('practiceSettings.bpm'),40);assert.equal(nodes.get('bpm-decrease').disabled,true);
 assert.equal(nodes.get('bpm').textContent,'40');
 run("$('settings-dialog').close();startMode('practice');now=1000;pause();openSettings()");
 assert.equal(run('bpm'),40);
 for(let value=50;value<=180;value+=10){click('bpm-increase');assert.equal(run('bpm'),value);}
 assert.equal(nodes.get('bpm-increase').disabled,true);click('bpm-increase');assert.equal(run('bpm'),180);
 click('bpm-decrease');assert.equal(run('bpm'),170);
 run("$('settings-dialog').close();const phase=elapsed;play();now+=1000;render(now)");
 assert.ok(Math.abs(run('elapsed-phase')-170/240)<1e-8);
 run("complete();startMode('challenge')");assert.equal(run('bpm'),120);
 run("complete();$('result-dialog').close();startMode('practice')");assert.equal(run('bpm'),170);
});
test('tempo changes preserve committed practice boundaries and correctly stamp future ones',()=>{
 const {run,nodes}=session();run("startMode('practice');now=6000;pause();const start=cards[0].startAt;for(const n of cards[0].targets)cards[0].hits.add(n)");
 for(let i=0;i<9;i++)nodes.get('bpm-increase').handlers.click({stopPropagation(){}});
 run('play();now=7000;render(now)');
 assert.equal(run('cards[0].startAt'),run('start'));
 assert.ok(Math.abs(run('cards[0].endAt')-(7-7.5/180))<1e-8);assert.equal(run('cards[0].endAt'),run('cards[1].startAt'));
 assert.equal(run('elapsed'),3);assert.equal(run('sessionSeconds'),7);
});

test('practice can play 100 consecutive early answers without freezing or scoring',()=>{
 for(const bpm of [90,180]){
  const {run}=session();run(`startMode('practice');bpm=${bpm};
   for(let i=0;i<100;i++){
    now=(i+2-1/32)*240000/bpm;render(now);
    for(const note of cards[i].targets)judgeMidi(note);
    now=(i+2.1)*240000/bpm;render(now);
    if(Math.abs(elapsed-(i+2.1))>1e-8)throw Error('Unexpected freeze at '+i);
   }`);
  assert.equal(run('run.total'),0);assert.equal(run('running'),true);
 }
});
function audioFixture(){
 const events=[];
 const audio={currentTime:0,state:'running',resume(){return Promise.resolve();},destination:{},createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};},createOscillator(){const oscillator={frequency:{setValueAtTime(value){oscillator.pitch=value;}},connect(){},disconnect(){},stop(){},start(at){events.push({at,oscillator:this});}};return oscillator;}};
 const app=session({AudioContext:function(){return audio;}});
 return {...app,events,audio};
}
test('practice defaults to audible count-in with one accent on release and respects mute',()=>{
 for(const muted of [false,true]){
  const {run,nodes,events,audio}=audioFixture();
  run("startMode('practice')");assert.equal(run('metronomeOn'),true);
  if(muted)nodes.get('metronome').handlers.click({stopPropagation(){}});
  audio.currentTime=8;run('now=8000;render(now)');
  const before=events.length;
  run('cards[0].targets=[60];cards[1].targets=[62];judgeMidi(60)');
  for(let beat=1;beat<=4;beat++){
   audio.currentTime=8+beat*60/90;
   run(`now=8000+${beat}*60000/bpm;render(now)`);
  }
  const count=events.slice(before);
  assert.deepEqual(count.map(e=>e.oscillator.pitch),muted?[]:[1400,1000,1000,1000,1400]);
  if(!muted)for(let i=0;i<count.length;i++)assert.ok(Math.abs(count[i].at-(8+i*60/90))<1e-8);
  assert.equal(run('cards[0].practicePassed'),true);
  assert.equal(run('elapsed'),3);
  run('render(now)');assert.equal(events.length,before+count.length);
 }
});
test('count-in pauses, changes tempo by remaining beats, and resets on restart',()=>{
 const {run,audio,events}=audioFixture();
 run("startMode('practice');now=8000;render(now);for(const n of cards[0].targets)judgeMidi(n)");
 audio.currentTime=1;run('now+=60000/bpm;pause();const beats=cards[0].retryBeats;now+=60000;render(now)');
 assert.ok(Math.abs(run('beats')-1)<1e-8);
 assert.equal(run('cards[0].retryBeats'),run('beats'));
 run('bpm=180;play();render(now)');const count=events.length;
 run('render(now)');assert.equal(events.length,count);
 run('now+=3*60000/bpm;render(now)');assert.equal(run('cards[0].practicePassed'),true);
 run('reset()');assert.equal(run('audioBarOffset'),0);assert.equal(run('cards[0].retryBeats'),undefined);
});
test('identical A and B require separate attacks across the count-in',()=>{
 const {run}=session();run("startMode('practice');now=8000;render(now);cards[0].targets=[60];cards[1].targets=[60];judgeMidi(60)");
 assert.equal(run('cards[0].retryBeats'),0);
 assert.equal(run('isCorrect(cards[1])'),false);
 run('now+=3.875*60000/bpm;judgeMidi(60)');assert.equal(run('isCorrect(cards[1])'),true);
});
test('a correct answer followed by a wrong note before close freezes, while partial answers never pass',()=>{
 for(const attempt of ['correct-then-wrong','partial','silent']){
  const {run}=session();run("startMode('practice');now=6000;render(now)");
  if(attempt==='correct-then-wrong')run('for(const n of cards[0].targets)judgeMidi(n);judgeMidi(1)');
  if(attempt==='partial')run('judgeMidi(cards[0].targets[0])');
  run('now=16000;render(now)');assert.equal(run('elapsed'),3);
  assert.equal(run('elements[0].dataset.feedback'),'wrong');
 }
});


test('challenge waits for the final note or chord fade and then exactly four beats',()=>{
 for(const stage of ['notes-two','triad'])for(const tempo of [90,137,180]){
  const {run,nodes}=session();
  if(stage==='notes-two')run("selectNode('notes-two')");
  run(`bpm=${tempo};play();now=1800000;render(now)`);
  const count=run('cards.length');
  run('now+=(cards.length+2-elapsed)*240000/bpm;render(now)');
  assert.equal(run('finished'),false);
  assert.equal(run('elements.at(-1).hidden'),false);
  run('now+=180;render(now)');
  assert.equal(run('elements.at(-1).hidden'),true);
  assert.equal(nodes.get('result-dialog').open,false);
  run('now+=3.99*60000/bpm;render(now)');
  assert.equal(nodes.get('result-dialog').open,false);
  run('now+=.01*60000/bpm;render(now)');
  assert.equal(nodes.get('result-dialog').open,true);
  assert.equal(run('cards.length'),count);
  assert.equal(run('run.total'),count);
  assert.equal(run('run.seconds'),1800);
 }
});
test('outro pauses, follows tempo changes, and resets on retry',()=>{
 const {run,nodes}=session();
 run('play();now=1800180;render(now);now+=60000/bpm;pause()');
 assert.ok(Math.abs(run('outroBeats')-1)<1e-8);
 run('now+=60000;render(now)');
 assert.equal(nodes.get('result-dialog').open,false);
 run('bpm=180;play();now+=2.99*60000/bpm;render(now)');
 assert.equal(nodes.get('result-dialog').open,false);
 run('now+=.01*60000/bpm;render(now)');
 assert.equal(nodes.get('result-dialog').open,true);
 run('reset()');assert.equal(run('outroBeats'),0);
});


test('unplayed notes and incomplete chords turn red at window close before bottom contact',()=>{
 for(const mode of ['challenge','practice'])for(const kind of ['note','silent-chord','partial-chord'])for(const tempo of [90,137,180]){
  const {run}=session();
  if(kind==='note')run("selectNode('notes-two')");
  run(`startMode('${mode}');bpm=${tempo};now=2.5*240000/bpm;render(now)`);
  if(kind==='partial-chord')run('judgeMidi(cards[0].targets[0])');
  run('now=(3-1/32)*240000/bpm-1;render(now)');
  assert.equal(run('elements[0].dataset.feedback'),'waiting');
  run('now+=1;render(now)');
  assert.equal(run('elements[0].dataset.feedback'),'wrong');
  assert.equal(run('elements[0].hidden'),false);
  assert.ok(run('elapsed')<3);
  const before=run('elements[0].style.transform');
  run('now=3*240000/bpm;render(now)');
  assert.notEqual(run('elements[0].style.transform'),before);
  assert.equal(run('elements[0].style.transform'),'translateY(264px)');
  assert.equal(run('elements[0].dataset.feedback'),'wrong');
  run('now+=200;render(now)');
  assert.equal(run('elements[0].hidden'),mode==='challenge');
  if(mode==='practice'){
   assert.equal(run('elapsed'),3);
   run('for(const note of cards[0].targets)judgeMidi(note)');
   assert.equal(run('elements[0].dataset.feedback'),'wrong');
   assert.equal(run('cards[0].retryBeats'),0);
  }
 }
});


test('successive recoveries survive delayed frames and give B a fresh full window',()=>{
 const {run}=session();run("startMode('practice');now=20000;render(now)");
 for(let i=0;i<3;i++){
  assert.equal(run('elapsed'),i+3);
  run(`for(const n of cards[${i}].targets)judgeMidi(n);constOrigin=now`);
  run('now+=240000/bpm+100;render(now)');
  assert.ok(run('elapsed')>i+3);
  assert.equal(run('audioBarOffset'),i+1);
  run('now=constOrigin+2*240000/bpm;render(now)');
  assert.equal(run('elapsed'),i+4);
  assert.ok(Math.abs(run(`cards[${i+1}].endAt-cards[${i+1}].startAt`)-240/90)<1e-8);
 }
});


test('visual count-in shows 3 2 1 GO on four beats even when muted',()=>{
 for(const tempo of [40,90,180])for(const muted of [true,false]){
  const {run,nodes}=audioFixture();
  run(`practiceSettings.bpm=${tempo};startMode('practice');metronomeOn=${!muted};now=3*240000/bpm;render(now)`);
  assert.equal(nodes.get('practice-count-in').hidden,true);
  run('for(const n of cards[0].targets)judgeMidi(n);const retryAt=now');
  for(let beat=0;beat<4;beat++){
   run(`now=retryAt+${beat}*60000/bpm;render(now)`);
   assert.equal(nodes.get('practice-count-in').hidden,false);
   assert.equal(nodes.get('practice-count-in').textContent,['3','2','1','GO!'][beat]);
   assert.equal(run('elapsed'),3);
  }
  run('now=retryAt+4*60000/bpm;render(now)');
  assert.equal(nodes.get('practice-count-in').hidden,true);
  assert.equal(run('cards[0].practicePassed'),true);
 }
});
test('visual count-in hides on pause and exit, resumes at the same beat and clears on reset',()=>{
 const {run,nodes}=session();
 run("startMode('practice');now=8000;render(now);for(const n of cards[0].targets)judgeMidi(n);now+=60000/bpm;pause()");
 assert.equal(nodes.get('practice-count-in').hidden,true);
 run('now+=60000;play()');assert.equal(nodes.get('practice-count-in').textContent,'2');
 assert.equal(nodes.get('practice-count-in').hidden,false);
 run('complete()');assert.equal(nodes.get('practice-count-in').hidden,true);
 run("startMode('practice')");assert.equal(nodes.get('practice-count-in').hidden,true);
 run('reset()');assert.equal(nodes.get('practice-count-in').hidden,true);
});


test('opening cues occupy the last four approach beats and the first input window opens only a thirty-second note before contact',()=>{
 for(const mode of ['practice','challenge'])for(const stage of ['notes-two','notes-all','major-root'])for(const tempo of mode==='practice'?[40,90,180]:[120]){
  const {run,nodes}=session();
  if(stage!=='major-root')run(`selectNode('${stage}')`);
  run(`practiceSettings.bpm=${tempo};startMode('${mode}');judgeMidi(cards[0].targets[0]);judgeMidi(1)`);
  assert.equal(run('cards[0].startAt'),undefined);
  assert.equal(run('cards[0].hits.size'),0);assert.equal(run('cards[0].wrong'),false);
  assert.equal(nodes.get('practice-count-in').hidden,true);
  run('metronomeOn=false;now=240000/bpm-1;render(now)');
  assert.equal(nodes.get('practice-count-in').hidden,true);
  for(let beat=0;beat<4;beat++){
   run(`now=(4+${beat})*60000/bpm;render(now);judgeMidi(cards[0].targets[0]);judgeMidi(1)`);
   assert.equal(nodes.get('practice-count-in').hidden,false);
   assert.equal(nodes.get('practice-count-in').textContent,['3','2','1','GO!'][beat]);
   assert.equal(run('cards[0].hits.size'),0);assert.equal(run('cards[0].wrong'),false);
  }
  run('now=(2-1/32)*240000/bpm-1;judgeMidi(cards[0].targets[0])');
  assert.equal(run('cards[0].hits.size'),0);
  run('now+=1;judgeMidi(cards[0].targets[0])');
  assert.equal(run('cards[0].hits.size'),1);
  assert.equal(nodes.get('practice-count-in').textContent,'GO!');
  run('now=2*240000/bpm;render(now)');assert.equal(nodes.get('practice-count-in').hidden,true);
 }
});
test('opening count-in survives pause and a practice tempo change without replaying earlier numbers',()=>{
 const {run,nodes}=session();run("startMode('practice');now=5*60000/bpm;pause()");
 assert.equal(nodes.get('practice-count-in').hidden,true);
 nodes.get('bpm-increase').handlers.click({stopPropagation(){}});
 run('now+=60000;play()');assert.equal(nodes.get('practice-count-in').textContent,'2');
 run('now+=60000/bpm;render(now)');assert.equal(nodes.get('practice-count-in').textContent,'1');
});

test('learning ignores transport shortcuts and clears input on visibility loss',()=>{
 const {run,nodes,documentHandlers}=session({},false);
 run("selectNode('quality-0');startLearning();judgeMidi(60)");
 documentHandlers.keydown({code:'Space'});
 assert.equal(run('running'),false);assert.equal(nodes.get('midi-warning').open,false);
 run('document.hidden=true');documentHandlers.visibilitychange();
 assert.equal(run('recognizer.candidates[0].hits.size'),0);assert.equal(run('learningActive'),true);
});

test('learning selects both enharmonic labels and shows inversion only',()=>{
 const {run,nodes}=session({},false);run("selectNode('quality-5');startLearning()");
 const buttons=nodes.get('learning-chords').children;
 buttons.find(b=>b.dataset.pc==='1'&&b.dataset.spelling==='0').handlers.click();
 assert.equal(buttons.filter(b=>b.attributes['aria-pressed']==='true').length,2);
 assert.ok(buttons.filter(b=>b.attributes['aria-pressed']==='true').every(b=>b.dataset.pc==='1'));
 assert.equal(nodes.get('learning-name').textContent,'原位');
 nodes.get('learning-positions').children[3].handlers.click();
 assert.equal(nodes.get('learning-name').textContent,'第一转位');
 run('judgeMidi(49);judgeMidi(53);judgeMidi(56);judgeMidi(58)');
 assert.equal(run('learningState.pc'),10);
 assert.equal(buttons.filter(b=>b.attributes['aria-pressed']==='true').length,2);
 assert.ok(buttons.filter(b=>b.attributes['aria-pressed']==='true').every(b=>b.dataset.pc==='10'));
});
