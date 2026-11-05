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
test('continuous training crosses 36 questions and stops at 30 minutes',()=>{
 const {run,nodes}=session();run('play();now=160000;render(now)');
 assert.equal(run('running'),true);assert.ok(run('cards.length')>36);assert.equal(nodes.get('count').textContent,'02:40 / 30:00');
 run('now=1801000;render(now)');assert.equal(run('finished'),true);assert.equal(run('running'),false);assert.equal(nodes.get('count').textContent,'30:00 / 30:00');assert.equal(nodes.get('overlay').hidden,false);
});
test('pause excludes elapsed wall time, tempo changes preserve timer, restart resets',()=>{
 const {run,nodes}=session();run('play();now=10000;pause();now=70000;render(now)');assert.equal(nodes.get('count').textContent,'00:10 / 30:00');
 run('bpm=120;play();now=75000;render(now)');assert.equal(nodes.get('count').textContent,'00:15 / 30:00');
 run('reset()');assert.equal(nodes.get('count').textContent,'00:00 / 30:00');assert.equal(run('elapsed'),0);
});
test('landed chord stays at the keyboard until the next chord lands',()=>{
 const {run}=session();run('play();now=8000;render(now)');
 assert.equal(run('elements[0].hidden'),false);
 assert.equal(run('elements[0].dataset.landed'),'true');
 const position=run('elements[0].style.transform');
 run('now=11999;render(now)');
 assert.equal(run('elements[0].hidden'),false);
 assert.equal(run('elements[0].style.transform'),position);
 assert.equal(run('elements[1].dataset.landed'),'false');
 run('now=12000;render(now)');
 assert.equal(run('elements[0].hidden'),true);
 assert.equal(run('elements[1].hidden'),false);
 assert.equal(run('elements[1].dataset.landed'),'true');
 assert.equal(run('elements[1].style.transform'),position);
 run('now=152000;render(now)');
 assert.equal(run('elements[35].hidden'),true);
 assert.equal(run('elements[36].hidden'),false);
 assert.equal(run('elements[36].dataset.landed'),'true');
});

test('chords descend continuously between beats and meet the key edge',()=>{
 const {run}=session();run('play();render(0)');
 const y=()=>Number(run('elements[0].style.transform').match(/translateY\((.*)px\)/)[1]);
 const top=y();assert.ok(top+36<=0);
 run('now=250;render(now)');const first=y();
 run('now=500;render(now)');const second=y();
 assert.ok(first>top);assert.ok(second>first);assert.equal(first-top,second-first);
 run('now=8000;render(now)');assert.equal(y(),264);
});
test('strike flashes only on visual contact, fades after 180ms and clears on pause and reset',()=>{
 const {run,nodes}=session();const flash=()=>Number(nodes.get('strike').style['--strike-flash']);
 run('bpm=60;play();render(0)');assert.equal(flash(),0);
 run('now=7820;render(now)');assert.equal(flash(),0);
 run('now=8000;render(now)');assert.ok(Math.abs(flash()-1)<1e-9);
 run('now=8090;render(now)');assert.ok(flash()>0&&flash()<1);
 run('now=8181;render(now)');assert.equal(flash(),0);
 run('now=12000;render(now)');assert.ok(Math.abs(flash()-1)<1e-9);
 run('pause()');assert.equal(flash(),0);
 run('now=20000;play()');assert.equal(flash(),0);
 run('now=24000;render(now)');assert.ok(Math.abs(flash()-1)<1e-9);
 run('reset()');assert.equal(flash(),0);
});

test('metronome schedules accented clicks, cancels on pause and skips missed beats',()=>{
 const scheduled=[];
 class AudioContext{
  state='running';currentTime=0;destination={};
  resume(){return Promise.resolve();}
  createOscillator(){const click={frequency:{setValueAtTime(value){click.pitch=value;}},connect(){},disconnect(){},start(time){click.time=time;scheduled.push(click);},stop(){click.stops=(click.stops||0)+1;}};return click;}
  createGain(){return {gain:{setValueAtTime(){},linearRampToValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){},disconnect(){}};}
 }
 const {run}=session({AudioContext});run('play();render(0)');
 assert.equal(scheduled.length,1);assert.equal(scheduled[0].pitch,1400);
 run('now=900;render(now)');assert.equal(scheduled.length,2);assert.equal(scheduled[1].pitch,1000);
 run('pause()');assert.equal(scheduled[1].stops,2);
 run('now=10000;render(now)');assert.equal(scheduled.length,2);
 run('play();now=10100;render(now)');assert.equal(scheduled.length,3);
 run('now=20000;render(now)');assert.ok(scheduled.length<=4);
 run('metronomeOn=false;stopMetronome();now=21000;render(now)');assert.ok(scheduled.length<=4);
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



test('opening lead-in reveals first answer and reset clears pause UI',()=>{
 const {run,nodes}=session();run('play();now=1000;pause()');
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),3);
 run('reset()');
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),0);
 assert.equal(nodes.get('settings-toggle').hidden,false);
});

test('keyboard frost defaults on only during training and reveals paused answers',()=>{
 const {run,nodes,documentHandlers}=session();
 const obscured=()=>nodes.get('keyboard').dataset.obscured;
 assert.equal(nodes.get('keyboard-blur').checked,true);
 assert.equal(obscured(),'false');assert.equal(nodes.get('keyboard-frost').hidden,false);
 assert.equal(nodes.get('keyboard-frost').dataset.obscured,'false');
 run('play()');assert.equal(obscured(),'true');assert.equal(nodes.get('keyboard-frost').hidden,false);
 assert.equal(nodes.get('keyboard-frost').dataset.obscured,'true');
 run('now=10000;render(now)');documentHandlers.click();
 assert.equal(obscured(),'false');assert.equal(nodes.get('keyboard-frost').hidden,false);
 assert.equal(nodes.get('keyboard-frost').dataset.obscured,'false');
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),3);
 run('openSettings()');assert.equal(obscured(),'false');
 run("$('settings-dialog').close();play()");assert.equal(obscured(),'true');
 run('complete()');assert.equal(obscured(),'false');
 run('play();reset()');assert.equal(obscured(),'false');
});
test('keyboard blur preference persists and disabling it keeps training keys clear',()=>{
 const stored=new Map();
 const localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 const {run,nodes}=session({localStorage});
 nodes.get('keyboard-blur').checked=false;nodes.get('keyboard-blur').handlers.change();
 assert.equal(stored.get('voicing-keyboard-blur'),'false');
 run('play()');assert.equal(nodes.get('keyboard').dataset.obscured,'false');
 assert.equal(nodes.get('keyboard-frost').hidden,true);
 const reload=session({localStorage});
 assert.equal(reload.nodes.get('keyboard-blur').checked,false);
 reload.run('play()');assert.equal(reload.nodes.get('keyboard').dataset.obscured,'false');
 reload.run('pause();openSettings()');
 reload.nodes.get('keyboard-blur').checked=true;reload.nodes.get('keyboard-blur').handlers.change();
 assert.equal(reload.nodes.get('keyboard').dataset.obscured,'false');
 reload.run("$('settings-dialog').close();play()");assert.equal(reload.nodes.get('keyboard').dataset.obscured,'true');
 assert.equal(stored.get('voicing-keyboard-blur'),'true');
});

test('phone mode hides keyboard during training and reveals answers without changing card spacing',()=>{
 const {run,nodes,documentHandlers}=session({navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}});
 assert.equal(nodes.get('instrument').dataset.phone,'true');
 assert.equal(nodes.get('keyboard-blur-setting').hidden,false);
 assert.equal(nodes.get('instrument').dataset.running,'false');
 run('play();now=10000;render(now)');
 assert.equal(nodes.get('instrument').dataset.running,'true');
 assert.equal(nodes.get('keyboard').dataset.obscured,'false');
 assert.equal(nodes.get('keyboard-frost').hidden,true);
 const positions=run('JSON.stringify(elements.slice(0,3).map(el=>el.style.transform))');
 const progress=run('elapsed');
 documentHandlers.click();run('now=50000;render(now)');
 assert.equal(nodes.get('instrument').dataset.running,'false');
 assert.equal(run('JSON.stringify(elements.slice(0,3).map(el=>el.style.transform))'),positions);
 assert.equal(run('elapsed'),progress);
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),3);
 run('openSettings()');assert.equal(nodes.get('instrument').dataset.running,'false');
 run("$('settings-dialog').close();play();render(now)");assert.equal(nodes.get('instrument').dataset.running,'true');
 assert.equal(run('elapsed'),progress);
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),0);
 run('complete()');assert.equal(nodes.get('instrument').dataset.running,'false');
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
  assert.equal(nodes.get('keyboard-blur-setting').hidden,false,c.ua);
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

test('correct MIDI notes fade until handoff; any later wrong note restores a permanent red label',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');
 run('play();now=8300;render(now)');
 assert.equal(run('elements[0].style.opacity'),'1');
 const pitches=JSON.parse(run('JSON.stringify(notes(cards[0].root,cards[0].q,cards[0].inv))'));
 send([0x90,pitches[0],100]);
 assert.equal(run('elements[0].dataset.feedback'),'waiting');
 run('now=10000;render(now)');
 assert.equal(run('elements[0].style.opacity'),'1');
 send([0x90,pitches[1],100]);send([0x90,pitches[2],100]);
 assert.equal(run('elements[0].dataset.feedback'),'correct');
 assert.equal(run('elements[0].style.opacity'),'0.5');
 send([0x90,0,100]);
 assert.equal(run('elements[0].dataset.feedback'),'wrong');
 assert.equal(run('elements[0].style.opacity'),'1');
 send([0x90,pitches[0],100]);run('now=11999;render(now)');
 assert.equal(run('elements[0].dataset.feedback'),'wrong');
 assert.equal(run('elements[0].style.opacity'),'1');
 run('now=12000;render(now)');assert.equal(run('elements[0].hidden'),true);
 assert.equal(run('elements[1].dataset.feedback'),'waiting');
});


test('answers completed in the advance window fade only after visual touch',async()=>{
 for(const stage of [0,5]){
  const {run,send}=midiSession();await run('connectMidi()');
  run(`stageIndex=${stage};reset();play();now=7820;render(now)`);
  const targets=JSON.parse(run('JSON.stringify(cards[0].targets)'));
  for(const pitch of targets)send([0x90,pitch,100]);
  assert.equal(run('cards[0].feedback'),'correct');
  assert.ok(Math.abs(Number(run('elements[0].style.opacity'))-1)<1e-9);
  run('now=8000;render(now)');assert.ok(Math.abs(Number(run('elements[0].style.opacity'))-1)<1e-9);
  run('now=10000;render(now)');assert.ok(Math.abs(Number(run('elements[0].style.opacity'))-.5)<1e-9);
 }
});

test('partial chords stay opaque through settlement and disappear only at visual handoff',async()=>{
 for(const count of [1,2]){
  const {run,send}=midiSession();await run('connectMidi()');
  run('play();now=7820;render(now)');
  const targets=JSON.parse(run('JSON.stringify(cards[0].targets)'));
  for(const pitch of targets.slice(0,count)){
   send([0x90,pitch,100]);send([0x80,pitch,0]);
  }
  for(const time of [8000,10000,11820,11999]){
   run(`now=${time};render(now)`);
   assert.equal(run('elements[0].dataset.feedback'),'waiting');
   assert.equal(run('elements[0].style.opacity'),'1');
   assert.equal(run('elements[0].hidden'),false);
  }
  assert.equal(run('cards[0].ended'),true);
  assert.equal(run('run.correct'),0);
  run('now=12000;render(now)');assert.equal(run('elements[0].hidden'),true);
 }
});

test('first wrong attack is sticky; note-off and pedal never judge; restart clears feedback',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('play();now=9000');
 send([0x80,0,100]);send([0x90,0,0]);send([0xb0,64,127]);
 assert.equal(run('cards[0].feedback'),undefined);
 send([0x90,0,100]);assert.equal(run('cards[0].feedback'),'wrong');
 send([0x90,run('cards[0].root'),100]);assert.equal(run('cards[0].feedback'),'wrong');
 run('reset()');assert.equal(run('cards[0].feedback'),undefined);
});



test('single-note practice requires exact pitch, freezes while paused, and hides a faded label at handoff',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('stageIndex=0;reset();play();now=8300');
 const root=run('cards[0].root');send([0x90,root,100]);
 assert.equal(run('cards[0].feedback'),'correct');
 run('now=10000;render(now);pause()');const opacity=run('elements[0].style.opacity');
 assert.equal(opacity,'1');
 send([0x90,0,100]);run('now=70000;render(now)');
 assert.equal(run('elements[0].style.opacity'),opacity);assert.equal(run('cards[0].feedback'),'correct');
 run('play();now=71999;render(now)');assert.ok(Number(run('elements[0].style.opacity'))<.001);
 run('now=72000;render(now)');assert.equal(run('elements[0].hidden'),true);
 // Release the first target: the next octave-error note may equal that held key.
 send([0x80,root,0]);run('now=72300');send([0x90,run('cards[1].root')+12,100]);
 assert.equal(run('cards[1].feedback'),'wrong');
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

test('pause shows only the current label at full brightness and resume restores the scene',()=>{
 for(const stage of [0,5]){
  const {run}=session();run(`stageIndex=${stage};reset();play();cards[0].feedback='correct';now=10000;render(now)`);
  assert.equal(run('elements[0].style.opacity'),'0.5');
  const positions=run('JSON.stringify(elements.slice(0,3).map(el=>el.style.transform))');
  assert.equal(run('elements[1].hidden'),false);
  run('pause()');assert.equal(run('elements[0].style.opacity'),'1');
  assert.equal(run('elements.filter(el=>!el.hidden).length'),1);
  assert.equal(run('elements[0].hidden'),false);
  run('now=70000;render(now);play()');
  assert.equal(run('elements[0].style.opacity'),'0.5');
  assert.equal(run('elements[1].hidden'),false);
  assert.equal(run('JSON.stringify(elements.slice(0,3).map(el=>el.style.transform))'),positions);
 }
});
test('opening pause keeps the first label only; wrong feedback survives pause and resume',()=>{
 const {run}=session();run('play();now=5000;pause()');
 assert.equal(run('elements.filter(el=>!el.hidden).length'),1);
 assert.equal(run('elements[0].hidden'),false);
 run("play();now=10000;render(now);cards[0].feedback='wrong';pause()");
 assert.equal(run('elements[0].dataset.feedback'),'wrong');
 assert.equal(run('elements[0].style.opacity'),'1');
 run('play()');assert.equal(run('elements[0].dataset.feedback'),'wrong');
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



test('wrong feedback updates once immediately and preserves already visible cards',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('selectStage(0);play();now=9000;render(now)');
 const before=run('JSON.stringify(cards.map(c=>[c.id,c.root]))');
 send([0x90,0,100]);send([0x90,0,100]);send([0x90,1,100]);
 assert.equal(run('levels[cards[0].id]'),1);assert.equal(run('JSON.stringify(cards.map(c=>[c.id,c.root]))'),before);
 run('now=13000;render(now)');assert.equal(run('cards.length'),4);
 assert.equal(run('levels[cards[0].id]'),1);
});


test('weakness persists across reloads and is shared with later cumulative stages',()=>{
 const stored=new Map();const localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
 const first=session({localStorage});first.run('bpm=60;play();now=9000;judgeMidi(0)');
 const id=first.run('cards[0].id');assert.equal(JSON.parse(stored.get('voicing-weakness-v1'))[id],1);
 const second=session({localStorage});second.run('selectStage(4)');assert.equal(second.run(`levels[${JSON.stringify(id)}]`),1);
});

test('page MIDI dialog blocks repeated starts and background shortcuts without browser alerts',()=>{
 const {run,nodes,alerts,documentHandlers}=session({},false);
 run('play()');assert.equal(nodes.get('midi-warning').open,true);
 for(let i=0;i<10;i++){
  run('play();play(true)');documentHandlers.click();
  documentHandlers.keydown({code:'Space',preventDefault(){}});
 }
 assert.equal(run('running'),false);
 assert.equal(run('started'),false);assert.equal(alerts.length,0);
 let stopped=false;nodes.get('midi-warning-close').handlers.click({stopPropagation(){stopped=true;}});
 assert.equal(stopped,true);assert.equal(nodes.get('midi-warning').open,false);assert.equal(run('running'),false);
 run('play()');
 nodes.get('midi-warning-connect').handlers.click({stopPropagation(){}});
 assert.equal(nodes.get('midi-warning').open,false);assert.equal(run('running'),false);
});

test('home settings are a separate modal; closing paused settings never resumes training',()=>{
 const {run,nodes,documentHandlers}=session();
 run('openSettings()');assert.equal(nodes.get('settings-dialog').open,true);assert.equal(nodes.get('session-stats').hidden,true);
 nodes.get('settings-close').handlers.click({stopPropagation(){}});assert.equal(run('started'),false);
 run('play();now=10000;pause();openSettings()');assert.equal(nodes.get('session-stats').hidden,false);assert.equal(nodes.get('exit-training').hidden,false);
 documentHandlers.click();assert.equal(run('running'),false);
 nodes.get('settings-close').handlers.click({stopPropagation(){}});assert.equal(run('running'),false);assert.equal(nodes.get('overlay').hidden,true);
 documentHandlers.click();assert.equal(run('running'),true);
});
test('phone keyboard visibility setting remains available and applies in both directions',()=>{
 const {run,nodes}=session({navigator:{userAgent:'iPhone'}});
 assert.equal(nodes.get('keyboard-blur-setting').hidden,false);run('play()');assert.equal(nodes.get('instrument').dataset.hideKeys,'true');
 run('pause();openSettings()');nodes.get('keyboard-blur').checked=false;nodes.get('keyboard-blur').handlers.change();
 run("$('settings-dialog').close();play()");assert.equal(nodes.get('instrument').dataset.hideKeys,'false');assert.equal(run('run.shownKeyboard'),true);
 run('pause()');nodes.get('keyboard-blur').checked=true;nodes.get('keyboard-blur').handlers.change();run('play()');assert.equal(nodes.get('instrument').dataset.hideKeys,'true');assert.equal(run('run.shownKeyboard'),true);
});
test('actual running speed is latched, homepage choices and transient paused choices are not',()=>{
 const {run,nodes}=session();nodes.get('speed').value=40;nodes.get('speed').handlers.change();nodes.get('speed').value=120;nodes.get('speed').handlers.change();
 run('play();now=1000;render(now);pause();openSettings()');assert.equal(run('run.minBpm'),120);
 for(const speed of [40,60,140]){nodes.get('speed').value=speed;nodes.get('speed').handlers.change();}
 run("$('settings-dialog').close();play();now=2000;render(now)");assert.equal(run('run.minBpm'),120);
 run('pause()');nodes.get('speed').value=60;nodes.get('speed').handlers.change();run('play();now=3000;render(now)');assert.equal(run('run.minBpm'),60);
});
test('zero-question exit creates a zero-star result; best rating survives later worse attempts and reload',()=>{
 const stored=new Map();const localStorage={getItem:k=>stored.get(k)??null,setItem:(k,v)=>stored.set(k,v)};
 const {run,nodes}=session({localStorage});assert.equal(run('Object.keys(results).length'),0);
 run('play();pause();openSettings()');nodes.get('exit-training').handlers.click({stopPropagation(){}});
 assert.equal(run("results['notes-two'].last.stars"),0);assert.equal(run('run.total'),0);assert.equal(nodes.get('overlay-action').disabled,false);
 run("$('result-dialog').close()");run('play();run.seconds=1800;run.total=100;run.correct=95;run.minBpm=90;complete()');assert.equal(run("results['notes-two'].best.stars"),3);
 run("$('result-dialog').close()");run('play();pause();complete()');assert.equal(run("results['notes-two'].last.stars"),0);assert.equal(run("results['notes-two'].best.stars"),3);
 const reload=session({localStorage});assert.equal(reload.run("results['notes-two'].best.stars"),3);
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
test('complete arpeggio counts correct at early settlement and lowers chord weakness exactly once',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('selectStage(stages.findIndex(s=>s.id===`chord-4-1`));play();now=9000;render(now);levels[cards[0].id]=2');
 for(const note of JSON.parse(run('JSON.stringify(cards[0].targets)'))){send([0x90,note,100]);send([0x80,note,0]);}
 assert.equal(run('run.correct'),0);assert.equal(run('levels[cards[0].id]'),2);
 run('now=11819;render(now)');assert.equal(run('run.total'),0);
 run('now=11820;render(now)');assert.equal(run('run.total'),1);assert.equal(run('run.correct'),1);assert.equal(run('levels[cards[0].id]'),1);
 run('now=13000;render(now)');assert.equal(run('levels[cards[0].id]'),1);
});
test('silent, partial, wrong, and assisted responses have separate accuracy, weakness, and color outcomes',async()=>{
 for(const mode of ['silent','partial','wrong','assisted']){
  const {run,send}=midiSession();await run('connectMidi()');run('selectStage(stages.findIndex(s=>s.id===`chord-4-1`));play();now=9000;render(now);levels[cards[0].id]=2');
  const targets=JSON.parse(run('JSON.stringify(cards[0].targets)'));
  if(mode!=='silent')for(const note of mode==='partial'?targets.slice(0,1):targets){send([0x90,note,100]);send([0x80,note,0]);}
  if(mode==='wrong'){send([0x90,0,100]);send([0x80,0,0]);send([0x90,0,100]);}
  if(mode==='assisted')run('pause();play()');
  run('now=12181;render(now)');assert.equal(run('run.total'),1,mode);assert.equal(run('run.correct'),mode==='assisted'?1:0,mode);
  assert.equal(run('cards[0].wrong'),mode==='wrong',mode);assert.equal(run('levels[cards[0].id]'),mode==='wrong'?3:2,mode);
 }
});
test('MIDI early switch credits only next question; held notes and note-offs never answer',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run("selectStage(stages.findIndex(s=>s.id===`chord-4-1`));play();while(cards.length<2)appendCard();cards[0]=prepareAttempt({kind:'chord',id:'chord:C:0:0',root:60,q:0,inv:0});cards[1]=prepareAttempt({kind:'chord',id:'chord:A:1:0',root:57,q:1,inv:0});now=11900");
 for(const note of [60,64,67,57,66]){send([0x90,note,100]);send([0x80,note,0]);}
 assert.equal(run('cards[0].hits.size'),0);assert.equal(run('cards[0].ended'),true);assert.equal(run('cards[1].feedback'),'wrong');
 run('now=12181;render(now)');assert.equal(run('run.correct'),0);
 // A key pressed before the next ordinary interval is not a new attack while held.
 send([0x90,60,100]);run('cards[1].hits.clear();now=13000');send([0x90,60,100]);assert.equal(run('cards[1].hits.size'),0);
 send([0x90,60,0]);send([0x90,60,100]);assert.equal(run('cards[1].hits.has(60)'),true);
});
test('disconnect pauses immediately and a partial last question is not settled on exit',async()=>{
 const {run,input,access}=midiSession();await run('connectMidi()');run('play();now=10000;render(now)');input.state='disconnected';access.onstatechange();assert.equal(run('running'),false);
 run('complete()');assert.equal(run('run.total'),0);
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

test('timing captures fresh attacks only, persists on pause, and survives restart',()=>{
 const saved=new Map(),localStorage={getItem:key=>saved.get(key)??(key==='voicing-bpm'?'60':null),setItem:(key,value)=>saved.set(key,value)};
 const {run,nodes}=session({localStorage});
 run("play();now=11820;receiveMidi('fixture',{data:[144,60,100],timeStamp:11800});receiveMidi('fixture',{data:[144,60,90],timeStamp:11810});receiveMidi('fixture',{data:[128,60,0],timeStamp:11820});now=13000;pause();openSettings()");
 assert.equal(run('timingRun.events.length'),1);assert.equal(run('timingRun.events[0].queueDelayMs'),20);
 assert.ok(nodes.get('timing-summary').textContent.includes('已记录 1 次按键'));
 assert.equal(JSON.parse(saved.get(timing.TIMING_KEY)).runs[0].events.length,1);
 run("now=14000;receiveMidi('fixture',{data:[144,62,100],timeStamp:14000});reset()");
 assert.equal(run('timingRuns[0].events.length'),1);
 const restored=session({localStorage});assert.equal(restored.run('timingRuns[0].events.length'),1);
});
test('timing persistence failures remain visible without interrupting training',()=>{
 const {run,nodes}=session({localStorage:{getItem(){return null;},setItem(){throw new Error('quota');}}});
 run('play();now=12000;judgeMidi(60);pause();openSettings()');
 assert.equal(run('timingStorageFailed'),true);assert.ok(nodes.get('timing-storage').textContent.includes('本地保存失败'));
 assert.equal(run('timingRun.events.length'),1);
});
test('timing export contains raw records and recomputable analysis',async()=>{
 let blob,revoked;
 const {run,nodes}=session({Blob,URL:{createObjectURL(value){blob=value;return 'blob:test';},revokeObjectURL(value){revoked=value;}},setTimeout(fn){fn();}});
 run('play();now=11820;judgeMidi(60);now=13000;pause()');
 nodes.get('timing-export').handlers.click();
 const payload=JSON.parse(await blob.text());assert.equal(payload.schema,1);assert.equal(payload.summary.recorded,1);
 assert.equal(payload.runs[0].events[0].observation.offsetMs,-180);assert.equal(revoked,'blob:test');
 assert.deepEqual(timing.analyzeTiming(timing.loadTiming(payload)),payload.summary);
});

test('paused labels and keyboard answers follow visual touch across the early judgment switch',()=>{
 for(const stage of [0,5])for(const time of [11819,11820,11999,12000]){
  const {run}=session();run(`stageIndex=${stage};reset();play();now=${time};render(now)`);
  const visualIndex=time<12000?0:1;
  const judgmentIndex=time<11820?0:1;
  assert.equal(run('activeQuestionIndex(cards,sessionSeconds)'),judgmentIndex);
  run('pause()');
  assert.equal(run('elements.filter(el=>!el.hidden).length'),1);
  assert.equal(run(`elements[${visualIndex}].hidden`),false);
  assert.equal(run(`cards[${visualIndex}].assisted`),true);
  assert.equal(run(`cards[${1-visualIndex}].assisted`),false);
  assert.equal(run(`Array.from(answerDots).every(([n,dot])=>dot.hidden===!cards[${visualIndex}].targets.includes(n))`),true);
  const total=run('run.total'),seconds=run('sessionSeconds');
  run('now=60000;render(now)');assert.equal(run('sessionSeconds'),seconds);
  run('play()');assert.equal(run('run.total'),total);
  assert.equal(run('activeQuestionIndex(cards,sessionSeconds)'),judgmentIndex);
 }
});
test('paused tempo changes freeze judgement; resume cannot reopen settled answers',()=>{
 const {run,nodes}=session();run('play();now=11830;pause()');
 nodes.get('speed').value=40;nodes.get('speed').handlers.change();
 assert.equal(run('activeQuestionIndex(cards,sessionSeconds)'),1);assert.equal(run('run.total'),1);
 run('now=50000;play();now=50010;render(now)');assert.equal(run('activeQuestionIndex(cards,sessionSeconds)'),1);assert.equal(run('run.total'),1);
});
test('faster tempo on resume switches immediately without backdating the frozen window',()=>{
 const {run,nodes}=session();run('play();now=11700;pause()');
 nodes.get('speed').value=140;nodes.get('speed').handlers.change();
 assert.equal(run('activeQuestionIndex(cards,sessionSeconds)'),0);assert.equal(run('run.total'),0);
 run('now=50000;play()');assert.equal(run('cards[0].endAt'),11.7);assert.equal(run('cards[1].startAt'),11.7);assert.equal(run('run.total'),1);
});
test('final arpeggio note at the shifted boundary belongs only to the next question',()=>{
 const {run}=session();run("play();while(cards.length<2)appendCard();cards[0]=prepareAttempt({kind:'chord',id:'first',root:60,q:0,inv:0});cards[1]=prepareAttempt({kind:'chord',id:'second',root:60,q:0,inv:0});now=11000;judgeMidi(60);judgeMidi(64);now=11820;judgeMidi(67)");
 assert.equal(run('run.total'),1);assert.equal(run('run.correct'),0);assert.equal(run('cards[0].hits.has(67)'),false);assert.equal(run('cards[1].hits.has(67)'),true);
 run('pause();complete()');assert.equal(run('run.total'),1);
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
test('reopening follows postorder progress, including a newly available parent',()=>{
 const full={started:true,seconds:1800,total:100,correct:100,minBpm:90,paused:false,shownKeyboard:false};
 const saved=Object.fromEntries(theory.curriculum[0].children.slice(0,4).map(n=>[n.id,{last:full,best:full}]));
 const {run}=session({localStorage:{getItem(key){return key==='voicing-results-v1'?JSON.stringify(saved):null;},setItem(){}}});
 assert.equal(run("stages[stageIndex].id"),'notes-all');assert.equal(run('expandedTop'),'project-notes');
});
test('all new four-note qualities require the fourth MIDI attack before correctness',()=>{
 for(const q of [4,5,6,8])for(let inv=0;inv<4;inv++){
  const {run}=session();run(`selectNode('chord-${q}-${inv}');play();now=9000;render(now)`);
  run('for(const note of cards[0].targets.slice(0,3))judgeMidi(note)');assert.equal(run('cards[0].hits.size'),3);assert.notEqual(run('cards[0].feedback'),'correct');
  run('judgeMidi(cards[0].targets[3])');assert.equal(run('cards[0].feedback'),'correct');
 }
});
test('startup expands all ancestors and children of the next quality mixture',()=>{
 const full={started:true,seconds:1800,total:100,correct:100,minBpm:90,paused:false,shownKeyboard:false};
 const saved=Object.fromEntries(theory.stages.slice(0,8).map(n=>[n.id,{last:full,best:full}]));
 const {run,nodes}=session({localStorage:{getItem:key=>key==='voicing-results-v1'?JSON.stringify(saved):null,setItem(){}}});
 assert.equal(run("stages[stageIndex].id"),'quality-0');assert.equal(run('expandedTop'),'project-core');assert.equal(run('expandedQuality'),'quality-0');
 assert.equal(nodes.get('route-third').children.length,3);assert.equal(nodes.get('overlay-action').disabled,false);
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
test('slowing near the end removes only unreachable tail and speeding resumes generation',()=>{
 const {run}=session();run('bpm=140;play();now=1795000;pause()');
 const count=run('cards.length');
 run('bpm=40;play()');assert.ok(run('cards.length')<count);
 assert.equal(run('cards.every((c,i)=>canReachLine(i))'),true);
 const trimmed=run('cards.length');run('pause();bpm=140;play()');assert.ok(run('cards.length')>trimmed);
});
test('result dialog reports results, blocks background starts and retries explicitly',()=>{
 const {run,nodes,documentHandlers}=session();run('play();now=1800000;render(now)');
 assert.equal(nodes.get('result-dialog').open,true);
 assert.equal(nodes.get('result-stars').children[0].textContent,'★★★');
 assert.equal(nodes.get('result-stars').children[1].style.width,run('`${calculateScore(run).stars/3*100}%`'));
 assert.equal(nodes.get('result-duration').textContent,'30 分 0 秒');
 documentHandlers.click();documentHandlers.keydown({code:'Space',preventDefault(){}});run('play()');assert.equal(run('running'),false);
 nodes.get('result-retry').handlers.click({stopPropagation(){}});
 assert.equal(nodes.get('result-dialog').open,false);assert.equal(run('running'),true);assert.equal(run('sessionSeconds'),0);
 run('pause();complete()');assert.equal(nodes.get('result-dialog').open,true);
 nodes.get('result-home').handlers.click({stopPropagation(){}});assert.equal(run('running'),false);assert.equal(nodes.get('overlay').hidden,false);
});
test('strike contact follows tempo changes and skips stale flashes after delayed frames',()=>{
 const {run,nodes}=session();const flash=()=>Number(nodes.get('strike').style['--strike-flash']);
 run('bpm=60;play();now=4000;pause();bpm=120;play();now=5990;render(now)');assert.equal(flash(),0);
 run('now=6000;render(now)');assert.ok(Math.abs(flash()-1)<1e-9);
 run('now=8500;render(now)');assert.equal(flash(),0);
 run('complete()');assert.equal(flash(),0);
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

test('ninth training entry point renders the special card and accepts freely spread MIDI tones',()=>{
 for(const q of [11,12,13]){
  const {run,nodes}=session();run(`selectNode('quality-${q}');play();now=9000;render(now)`);
  assert.equal(nodes.get('route-third').hidden,true);
  assert.equal(run('elements[0].dataset.freeOctaves'),'true');
  assert.ok(run('cards[0].root>=48&&cards[0].root<60'));
  run('for(const [i,pitch] of cards[0].targets.slice(1).entries())judgeMidi(pitch+12*(i%3))');
  assert.equal(run('cards[0].hits.size'),4);assert.notEqual(run('cards[0].feedback'),'correct');
  run('judgeMidi(cards[0].root)');assert.equal(run('cards[0].feedback'),'correct');
  run('pause();showAnswer()');
  assert.equal(run('answerDots.get(cards[0].root).hidden'),false);
  assert.equal(run('answerDots.get(cards[0].root+12).hidden'),true);
  assert.equal(run('answerDots.get(cards[0].targets[1]+12).hidden'),false);
 }
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

test('practice misses pause at visual contact, reveal A and rewind pending B by four beats',()=>{
 const {run,nodes}=session();run("startMode('practice');now=8000;render(now)");
 const startPc=run('cards[0].pc');
 const pending=run('JSON.stringify(cards.slice(1).map(c=>[c.id,c.root]))');
 run('now=11820;render(now)');assert.equal(run('running'),true);
 run('now=12000;render(now)');assert.equal(run('running'),false);
 assert.equal(run('practiceMistake'),true);assert.equal(run('sessionSeconds'),12);
 assert.equal(run('cards[0].pc'),startPc);assert.equal(run('visualQuestionIndex()'),0);
 assert.equal(run('elements[0].hidden'),false);assert.equal(run('elements[1].hidden'),true);
 assert.equal(run('cards[0].targets.every(n=>!answerDots.get(n).hidden)'),true);
 run('for(const note of cards[0].targets)judgeMidi(note)');assert.equal(run('cards[0].hits.size'),0);
 run('now=40000;play()');assert.equal(run('elapsed'),1);assert.equal(run('sessionSeconds'),12);
 assert.equal(run('JSON.stringify(cards.slice(0,2).map(c=>[c.id,c.root]))'),pending);
 assert.equal(run('cards[0].pc'),(startPc+5)%12);assert.equal(run('cards[0].hits.size'),0);
 run('now=43820;for(const n of cards[0].targets)judgeMidi(n)');assert.equal(run('cards[0].hits.size'),0);
 run('now=44000;for(const n of cards[0].targets)judgeMidi(n)');assert.equal(run('cards[0].feedback'),'correct');
 run('now=48000;render(now)');assert.equal(run('running'),true);assert.equal(run('cards[0].pc'),(startPc+10)%12);
 assert.equal(run('run.total'),2);assert.equal(run('run.correct'),1);
 assert.equal(run('Object.keys(levels).length'),0);assert.equal(run('Object.keys(results).length'),0);
 run('complete()');assert.equal(nodes.get('result-dialog').open,false);assert.equal(run('timingRuns.length'),0);
});

test('practice detects wrong notes and incomplete answers, caps delayed frames at the error and accepts tempo changes',()=>{
 const {run}=session();run("startMode('practice');now=8000;render(now);judgeMidi(1);now=50000;render(now)");
 const startPc=run('cards[0].pc');
 assert.equal(run('cards[0].wrong'),true);assert.equal(run('sessionSeconds'),12);
 assert.equal(run('running'),false);
 run('bpm=120;play();now=52000;render(now)');assert.equal(run('elapsed'),2);
 run('judgeMidi(cards[0].targets[0]);now=54000;render(now)');
 assert.equal(run('running'),false);assert.equal(run('sessionSeconds'),16);
 assert.equal(run('cards[0].pc'),(startPc+5)%12);
 run('play();now=56000;for(const n of cards[0].targets)judgeMidi(n);now=58000;render(now)');
 assert.equal(run('running'),true);assert.equal(run('cards[0].pc'),(startPc+15)%12);
});

test('manual pause does not rewind practice or count paused time',()=>{
 const {run}=session();run("startMode('practice');now=9000;pause()");
 const progress=run('elapsed');run('now=100000;play()');assert.equal(run('elapsed'),progress);
 assert.equal(run('practiceMistake'),false);assert.equal(run('sessionSeconds'),9);
 run('now=101000;render(now)');assert.equal(run('sessionSeconds'),10);
});

test('practice runs beyond an hour while keeping a bounded card queue and separate progress',()=>{
 const {run,nodes}=session();run("startMode('practice');now=8000;render(now)");
 run(`for(let i=0;i<1000;i++){
  for(const note of cards[0].targets)judgeMidi(note);
  now+=4000;render(now);
  if(!running||cards.length>4||elements.length>4)throw new Error('Practice queue stopped or grew');
 }`);
 assert.equal(run('sessionSeconds'),4008);assert.equal(run('run.seconds'),4008);
 assert.equal(nodes.get('training-time').textContent,'66:48');assert.equal(nodes.get('count').textContent,'66:48');
 assert.equal(run('run.total'),1000);assert.equal(run('run.correct'),1000);
 assert.equal(run('timingRuns.length'),0);assert.equal(run('Object.keys(levels).length'),0);
 run('complete()');assert.equal(run('Object.keys(results).length'),0);
});

test('expanded route surface handles touch dragging and wheel without starting a mode',()=>{
 const {run,nodes}=session(),surface=nodes.get('route-surface'),row=nodes.get('route-second');
 surface.handlers.pointerdown({pointerType:'touch',pointerId:3,clientX:300});
 surface.handlers.pointermove({pointerId:3,clientX:100,preventDefault(){}});
 surface.handlers.pointerup({pointerId:3});assert.equal(row.scrollLeft,200);
 surface.handlers.wheel({deltaX:0,deltaY:40,deltaMode:0,preventDefault(){}});assert.equal(row.scrollLeft,240);
 assert.equal(run('started'),false);
});

test('held practice keys must be released and attacked again after error recovery',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run("startMode('practice');now=12000;render(now)");
 const target=run('cards[1].targets[0]');send([0x90,target,100]);
 assert.equal(run('cards[0].hits.size'),0);
 run('play();now=16000;render(now)');send([0x90,target,100]);
 assert.equal(run('cards[0].hits.size'),0);
 send([0x80,target,0]);send([0x90,target,100]);assert.equal(run('cards[0].hits.size'),1);
});

test('practice windows stay aligned across repeated fractional-tempo boundaries',()=>{
 for(const tempo of [40,90,140]){
  const {run}=session();run(`bpm=${tempo};startMode('practice');now=480000/bpm;render(now)`);
  run(`for(let i=0;i<100;i++){
   for(const note of cards[0].targets)judgeMidi(note);
   now+=(3-elapsed)*240000/bpm;render(now);
   if(!running)throw new Error('Practice lost a correct answer at a fractional boundary');
  }`);
  assert.equal(run('run.correct'),100);
 }
});

test('dragging reverses immediately after reaching the chain edge and capture loss cancels movement',()=>{
 const {run,nodes}=session(),surface=nodes.get('route-surface'),row=nodes.get('route-second');
 let scroll=0;Object.defineProperty(row,'scrollLeft',{get:()=>scroll,set:value=>{scroll=Math.max(0,Math.min(100,value));}});
 run("selectNode('quality-10')");
 const selected=run('stageIndex');
 surface.handlers.pointerdown({pointerType:'touch',pointerId:5,clientX:300});
 surface.handlers.pointermove({pointerId:5,clientX:0,preventDefault(){}});assert.equal(scroll,100);
 surface.handlers.pointermove({pointerId:5,clientX:20,preventDefault(){}});assert.equal(scroll,80);
 surface.handlers.lostpointercapture({pointerId:5});
 surface.handlers.pointermove({pointerId:5,clientX:40,preventDefault(){}});assert.equal(scroll,80);
 assert.equal(run('stageIndex'),selected);assert.equal(run('expandedQuality'),'quality-10');
});
