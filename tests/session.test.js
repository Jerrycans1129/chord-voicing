import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as theory from '../dist/theory.js';
import {BUILD_REVISION} from '../dist/build.js';
import {Scheduler,PracticeScheduler,cleanLevels} from '../dist/scheduler.js';
import * as scoring from '../dist/scoring.js';
import * as judgment from '../dist/judgment.js';
import * as timing from '../dist/timing.js';
function session(extras={},connected=true){
 const nodes=new Map(),documentHandlers={},alerts=[];
 const element=()=>({open:false,click(){this.clicked=true;},showModal(){this.open=true;},close(){this.open=false;},style:{setProperty(key,value){this[key]=value;}},dataset:{},hidden:false,textContent:'',value:'',clientHeight:300,setAttribute(){},children:[],append(...items){this.children.push(...items);},replaceChildren(...items){this.children=[...items];},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},queries:new Map(),querySelector(selector){if(!this.queries.has(selector))this.queries.set(selector,element());return this.queries.get(selector);},scrollLeft:0,scrollIntoView(){},setPointerCapture(){},hasPointerCapture(){return false;},releasePointerCapture(){}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({alert:message=>alerts.push(message),...theory,BUILD_REVISION,Scheduler,PracticeScheduler,cleanLevels,...scoring,...judgment,...timing,now:0,document:{getElementById:get,createElement:element,addEventListener(type,fn){documentHandlers[type]=fn;}},localStorage:{getItem(key){return key==='voicing-stage'?'0':key==='voicing-bpm'?'60':null;},setItem(){}},performance:{now:()=>context.now},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame(){},...extras});
 vm.runInContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,''),context);
 if(!extras.localStorage)vm.runInContext('selectStage(5)',context);
 if(connected)vm.runInContext("midiInputs.set('fixture',{state:'connected'})",context);
 return {run:code=>vm.runInContext(code,context),nodes,documentHandlers,alerts};
}
test('pause excludes elapsed wall time, tempo changes preserve timer, restart resets',()=>{
 const {run,nodes}=session();run('play();now=10000;pause();now=70000;render(now)');assert.equal(nodes.get('count').textContent,'00:10 / 30:00');
 run('bpm=120;play();now=75000;render(now)');assert.equal(nodes.get('count').textContent,'00:15 / 30:00');
 run('reset()');assert.equal(nodes.get('count').textContent,'00:00 / 30:00');assert.equal(run('elapsed'),0);
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
 send([0x90,20,100]);assert.match(nodes.get('midi-notes').textContent,/1 键超出/);
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

 test('unplayed labels stay opaque from touch until the next touch',()=>{
 const {run}=session();run('play();now=8000;render(now)');
 assert.equal(run('elements[0].style.opacity'),'1');
 run('now=10000;render(now)');assert.equal(run('elements[0].style.opacity'),'1');
 assert.equal(run('cards[0].feedback'),undefined);
 run('now=11999;render(now)');assert.equal(run('elements[0].style.opacity'),'1');
 run('now=12000;render(now)');assert.equal(run('elements[0].hidden'),true);
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
  assert.equal(run('Object.keys(results).length'),0);assert.equal(run('timingRuns.length'),0);
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
  run('now=1800000;render(now)');assert.equal(run('finished'),true);
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
 assert.equal(nodes.get('training-time').textContent,'02:03');
 assert.equal(nodes.get('training-header').hidden,false);
 run('now=500000;render(now)');assert.equal(nodes.get('training-time').textContent,'02:03');
 run('play();now=501000;render(now)');assert.equal(nodes.get('training-time').textContent,'02:04');
 run('complete()');assert.equal(nodes.get('training-header').hidden,true);
 run('reset();play()');assert.equal(nodes.get('training-time').textContent,'00:00');
});


test('practice availability follows the selected node and challenge remains available',()=>{
 const {run,nodes}=session();
 for(const id of ['notes-two','notes-all','level-2','level-6-v2']){
  run(`selectNode('${id}')`);assert.equal(nodes.get('practice-action').hidden,true);
  assert.equal(nodes.get('overlay-action').disabled,false);
  run("startMode('practice')");assert.equal(run('started'),false);
 }
 for(const id of ['quality-0','chord-10-3','quality-11']){
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

test('challenge locks defaults, hides settings while paused, and preserves practice choices',()=>{
 const {run,nodes}=session();
 run("practiceSettings.metronomeOn=false;startMode('challenge');now=6000;pause()");
 assert.equal(run('bpm'),90);assert.equal(run('keyboardBlurOn'),true);
 assert.equal(nodes.get('pause-screen').hidden,false);assert.equal(nodes.get('settings-toggle').hidden,true);
 run('openSettings()');assert.equal(nodes.get('settings-dialog').open,false);
 assert.equal(run('[...answerDots.values()].every(d=>d.hidden)'),true);
 assert.equal(readFileSync(new URL('../dist/index.html',import.meta.url),'utf8').includes('id="speed"'),false);
 run('now=66000;play()');assert.equal(run('sessionSeconds'),6);
 run("complete();$('result-dialog').close();startMode('practice')");
 assert.equal(run('bpm'),90);assert.equal(run('keyboardBlurOn'),false);
});
test('challenge labels cross the line, settle at the bottom, and incorrect attempts stack once',()=>{
 const {run,nodes}=session();run("$('performance-frost').clientHeight=96");
 run('play();now=5400;render(now)');const first=run('elements[0].style.transform');
 run('now=7000;render(now)');assert.notEqual(run('elements[0].style.transform'),first);assert.equal(run('run.total'),0);
 run('now=8000;render(now)');assert.equal(run('run.total'),1);assert.equal(run('elements[0].hidden'),true);
 assert.equal(nodes.get('mistake-blocks').children.length,1);
 run('render(now)');assert.equal(nodes.get('mistake-blocks').children.length,1);
});
test('complete chords disappear without blocks; later wrong notes remain incorrect',()=>{
 for(const wrong of [false,true]){
  const {run,nodes}=session();run('play();now=5500;for(const n of cards[0].targets)judgeMidi(n)');
  if(wrong)run('judgeMidi(1)');
  run('now=8000;render(now)');assert.equal(run('run.correct'),wrong?0:1);assert.equal(nodes.get('mistake-blocks').children.length,wrong?1:0);
 }
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
test('eighth mistake on one pitch fails immediately and resets all stacks on retry',()=>{
 const {run,nodes}=session();run(`play();const original=scheduler.next();scheduler.next=()=>({...original,root:60});cards[0].root=60;now=100000;render(now)`);
 assert.equal(run('finished'),true);assert.equal(run('run.failed'),true);assert.equal(run('run.total'),8);
 assert.equal(run('calculateScore(run).stars'),0);assert.ok(run('sessionSeconds')<100);
 assert.equal(nodes.get('mistake-blocks').children.length,8);
 run("$('result-dialog').close();play()");assert.equal(run('mistakeStacks.size'),0);
});
test('a delayed frame stops at the first overflowing stack, not at its final wall time',()=>{
 const {run}=session();run(`play();const original=scheduler.next();scheduler.next=()=>({...original,root:60});cards[0].root=60;now=1800000;render(now)`);
 assert.equal(run('run.total'),8);assert.ok(Math.abs(run('sessionSeconds')-80/3)<1e-7);
});
test('full thirty minutes with correct MIDI answers finishes and awards three stars',()=>{
 const {run,nodes}=session();run(`play();for(let i=0;i<673;i++){now=(i+2)*240000/90+1;render(now);for(const n of cards[i].targets)judgeMidi(n);}now=1800000;render(now)`);
 assert.equal(run('finished'),true);assert.equal(run('run.failed'),false);assert.equal(run('run.seconds'),1800);
 assert.equal(run('calculateScore(run).stars'),3);assert.equal(nodes.get('count').textContent,'30:00 / 30:00');
});
test('only final best stars persist; settings and timing are memory-only',()=>{
 const writes=new Map();const {run,nodes}=session({localStorage:{getItem(){return null;},setItem(k,v){writes.set(k,v);}}});
 run('practiceSettings.metronomeOn=false');
 run('play();now=5500;for(const n of cards[0].targets)judgeMidi(n);pause();complete()');
 assert.deepEqual([...writes.keys()],['voicing-stars']);const saved=JSON.parse(writes.get('voicing-stars'));
 assert.ok(Object.values(saved).every(x=>typeof x==='number'));
 const restored=session({localStorage:{getItem(k){return k==='voicing-stars'?JSON.stringify(saved):null;},setItem(){}}});
 assert.equal(restored.run('bpm'),90);assert.equal(restored.run('timingRuns.length'),0);
});
test('block centers shift only C E F B, and the twelve pitch lanes do not overlap',()=>{
 const {run,nodes}=session();run('play();for(let root=48;root<60;root++)settleCard(prepareAttempt({...cards[0],root,ended:false}))');
 const blocks=nodes.get('mistake-blocks').children;assert.equal(blocks.length,12);
 const left=blocks.map(b=>parseFloat(b.style.left));for(let i=1;i<12;i++)assert.ok(left[i]-left[i-1]>=.42/22*100-1e-8);
 assert.ok(Math.abs(left[0]-(.355-.21)/22*100)<1e-8);
});
test('pausing freezes all cards and ignores MIDI, and exiting a seventh-stack question can fail',()=>{
 const {run,nodes}=session();run('play();now=6000;pause()');
 const position=run('elements[0].style.transform');
 run('now=60000;for(const n of cards[0].targets)judgeMidi(n);render(now)');
 assert.equal(run('elements[0].style.transform'),position);assert.equal(run('cards[0].hits.size'),0);
 assert.equal(nodes.get('pause-screen').hidden,false);
 run('mistakeStacks.set(cards[0].root,7);complete()');assert.equal(run('run.failed'),true);assert.equal(run('run.total'),1);
});
test('zero-star home ratings are blank and do not replace previously earned stars',()=>{
 const {run}=session();run('play();results[stages[stageIndex].id]={best:{stars:2.5}};complete()');
 assert.equal(run('results[stages[stageIndex].id].best.stars'),2.5);
 run("$('result-dialog').close();play();complete()");assert.equal(run('results[stages[stageIndex].id].best.stars'),2.5);
});


test('practice is fixed at 90 BPM, shows only A during its initial four-beat descent, and hides its answer until solved',()=>{
 for(const userAgent of ['iPhone','iPad','Macintosh']){
  const {run,nodes}=session({navigator:{userAgent}});run("startMode('practice');const first=cards[0]");
  assert.equal(run('metronomeOn'),false);assert.equal(run('bpm'),90);assert.equal(run('cards.length'),1);assert.equal(run('keyboardBlurOn'),false);
  assert.equal(nodes.get('keyboard-frost').hidden,true);
  assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
  assert.equal(run('elements[0].style.transform'),'translateY(220px)');
  run('now=1333.3333333333;render(now)');assert.ok(Math.abs(parseFloat(run('elements[0].style.transform').slice(11))-242)<1e-8);
  run('now=2666;render(now)');assert.equal(run('cards.length'),1);
  run('now=2666.6666666667;render(now)');assert.equal(run('cards.length'),2);
  assert.equal(run('cards[0]===first'),true);assert.equal(run('elements[0].style.transform'),'translateY(264px)');
  assert.equal(run('elements[1].style.transform'),'translateY(220px)');
 }
});
test('A and B remain still indefinitely without adding more labels or scoring',()=>{
 const {run,nodes}=session();run("startMode('practice');now=16000;render(now);const first=cards[0],preview=cards[1];now=7200000;render(now)");
 assert.equal(run('cards[0]===first&&cards[1]===preview'),true);assert.equal(run('cards.length'),2);
 assert.equal(run('elements[0].style.transform'),'translateY(264px)');assert.equal(run('elements[1].style.transform'),'translateY(220px)');
 assert.equal(nodes.get('training-time').textContent,'120:00');assert.equal(run('run.total'),0);
 assert.equal(run('Object.keys(results).length'),0);assert.equal(run('running'),true);
});
test('playing A, missing notes or wrong notes leaves both labels unchanged and permits retry',()=>{
 const {run}=session();run("startMode('practice');now=16000;render(now);const first=cards[0];const preview=cards[1];for(const n of first.targets)judgeMidi(n);judgeMidi(1)");
 assert.equal(run('cards[0]===first'),true);
 run('judgeMidi(preview.targets[0])');assert.equal(run('cards[0]===first'),true);
 assert.equal(run('elements.every(e=>e.dataset.feedback===\'waiting\'&&e.style.opacity===\'1\')'),true);
 run('judgeMidi(1);for(const n of preview.targets)judgeMidi(n)');
 assert.equal(run('cards[0]===preview'),true);assert.equal(run('cards.length'),1);
 assert.equal(run('practiceFallProgress'),5);assert.equal(run('cards[0].targets.every(n=>!answerDots.get(n).hidden)'),true);
});
test('correct B starts a four-beat descent at the same position and C appears only on contact',()=>{
 const {run}=session();run("startMode('practice');now=16000;render(now);for(const n of cards[0].targets)judgeMidi(n);const preview=cards[1];const before=elements[1].style.transform;for(const n of preview.targets)judgeMidi(n)");
 assert.equal(run('elements[0].style.transform'),run('before'));assert.equal(run('cards.length'),1);
 run('now=17333.3333333333;render(now)');assert.ok(Math.abs(run('practiceFallProgress')-5.5)<1e-8);
 run('now=18666.6666666667;render(now)');assert.equal(run('cards.length'),2);
 assert.equal(run('cards[0]===preview'),true);assert.equal(run('practiceFallProgress'),6);
 assert.equal(run('elements[0].style.transform'),'translateY(264px)');assert.equal(run('elements[1].style.transform'),'translateY(220px)');
});
test('preview recognition requires fresh MIDI attacks and rejects extra held wrong notes',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run("startMode('practice');now=16000;render(now);for(const n of cards[0].targets)judgeMidi(n);cards[1].targets=[60,64,67];const preview=cards[1]");
 send([0x90,61,100]);for(const n of [60,64,67])send([0x90,n,100]);
 assert.equal(run('cards[1]===preview'),true);
 send([0x80,61,0]);send([0x90,67,100]);assert.equal(run('cards.length'),2);
 send([0x80,67,0]);send([0x90,67,100]);assert.equal(run('cards[0]===preview'),true);assert.equal(run('cards.length'),1);
});
test('pause freezes the moving label and timer and cannot advance through MIDI',()=>{
 const {run}=session();run("startMode('practice');now=16000;render(now);for(const n of cards[0].targets)judgeMidi(n);for(const n of cards[1].targets)judgeMidi(n);now=17000;pause();const phase=practiceFallProgress");
 run('now=117000;render(now)');assert.equal(run('practiceFallProgress'),run('phase'));assert.equal(run('sessionSeconds'),17);
 run('play();now=118666.6666666667;render(now)');assert.equal(run('cards.length'),2);
 run('pause();const first=cards[0];for(const n of cards[1].targets)judgeMidi(n)');assert.equal(run('cards[0]===first'),true);
 assert.equal(run('cards[0].targets.every(n=>!answerDots.get(n).hidden)'),true);
});
test('repeated self-paced transitions keep only A and B and never score or accumulate blocks',()=>{
 const {run}=session();run("startMode('practice');now=16000;render(now)");
 run(`for(const n of cards[0].targets)judgeMidi(n);for(let i=0;i<100;i++){
  for(const n of cards[1].targets)judgeMidi(n);
  if(cards.length!==1)throw Error('Preview did not advance');
  now+=240000/90;render(now);
  if(cards.length!==2||practiceFallProgress!==6)throw Error('Next preview missing');
 }`);
 assert.equal(run('run.total'),0);assert.equal(run('mistakeStacks.size'),0);assert.equal(run('Object.keys(results).length'),0);
});

test('practice requires the first answer before unlocking previews and never reuses its final attack',()=>{
 const {run}=session();run("startMode('practice');now=3000;render(now);cards[0].targets=[60,64,67];cards[1].targets=[62,65,67]");
 run('for(const n of cards[1].targets)judgeMidi(n)');
 assert.equal(run('cards[1].hits.size'),0);assert.equal(run('cards.length'),2);
 assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
 run('judgeMidi(1);for(const n of cards[0].targets)judgeMidi(n)');
 assert.equal(run('cards[0].practiceSolved'),true);assert.equal(run('cards[1].hits.size'),0);
 assert.equal(run('cards[0].targets.every(n=>!answerDots.get(n).hidden)'),true);
 run('judgeMidi(62);judgeMidi(65)');assert.equal(run('cards.length'),2);
 run('judgeMidi(67)');assert.equal(run('cards.length'),1);assert.equal(run('cards[0].practiceSolved'),true);
 run('now+=240000/90;render(now);for(const n of cards[1].targets)judgeMidi(n)');
 assert.equal(run('cards.length'),1);
});
test('pause preserves first-answer secrecy and clears partial attempts; reset hides answers again',()=>{
 const {run}=session();run("startMode('practice');now=3000;render(now);judgeMidi(cards[0].targets[0]);pause()");
 assert.equal(run('cards[0].hits.size'),0);
 assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
 run('for(const n of cards[0].targets)judgeMidi(n);play()');
 assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
 run('for(const n of cards[0].targets)judgeMidi(n)');
 assert.equal(run('cards[0].practiceSolved'),true);
 run('reset();play()');assert.equal(run('[...answerDots.values()].every(dot=>dot.hidden)'),true);
});
