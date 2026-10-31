import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stages,makeRound,notes} from '../dist/theory.js';
function session(extras={}){
 const nodes=new Map(),documentHandlers={};
 const element=()=>({style:{setProperty(key,value){this[key]=value;}},dataset:{},hidden:false,textContent:'',value:'',clientHeight:300,setAttribute(){},append(){},replaceChildren(){},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},querySelector(){return this;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({stages,makeRound,notes,now:0,document:{getElementById:get,createElement:element,addEventListener(type,fn){documentHandlers[type]=fn;}},localStorage:{getItem(key){return key==='voicing-stage'?'0':null;},setItem(){}},performance:{now:()=>context.now},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame(){},...extras});
 vm.runInContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/,''),context);
 return {run:code=>vm.runInContext(code,context),nodes,documentHandlers};
}
test('continuous training crosses 36 questions and stops at 30 minutes',()=>{
 const {run,nodes}=session();run('play();now=160000;render(now)');
 assert.equal(run('running'),true);assert.ok(run('cards.length')>36);assert.equal(nodes.get('timer').textContent,'02:40');
 run('now=1801000;render(now)');assert.equal(run('finished'),true);assert.equal(run('running'),false);assert.equal(nodes.get('timer').textContent,'30:00');assert.equal(nodes.get('overlay-action').textContent,'再练一轮 →');
});
test('pause excludes elapsed wall time, tempo changes preserve timer, restart resets',()=>{
 const {run,nodes}=session();run('play();now=10000;pause();now=70000;render(now)');assert.equal(nodes.get('timer').textContent,'00:10');
 run('bpm=120;play();now=75000;render(now)');assert.equal(nodes.get('timer').textContent,'00:15');
 run('reset()');assert.equal(nodes.get('timer').textContent,'00:00');assert.equal(run('elapsed'),0);
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
test('background pulse follows tempo and preserves its phase while paused',()=>{
 const {run,nodes}=session();run('bpm=120;play();render(0)');
 const glow=()=>nodes.get('lanes').style['--beat-glow'];
 assert.equal(glow(),'1');
 run('now=250;render(now);pause()');const dim=glow();assert.ok(Number(dim)<1);
 const position=run('elements[0].style.transform');
 run('now=10000;render(now)');assert.equal(glow(),dim);assert.equal(run('elements[0].style.transform'),position);
 run('play();now=10250;render(now)');assert.equal(glow(),'1');
 run('now=14000;render(now)');assert.equal(run('elements[0].dataset.landed'),'true');
 assert.equal(run("elements[0].style['--beat-glow']"),undefined);
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


test('screen clicks pause with the landed answer, open settings separately, and resume',()=>{
 const {run,nodes,documentHandlers}=session();
 const visible=()=>run('JSON.stringify([...answerDots].filter(([,dot])=>!dot.hidden).map(([midi])=>midi))');
 run('play();now=10000;render(now)');documentHandlers.click();
 assert.equal(run('running'),false);
 assert.equal(nodes.get('overlay').hidden,true);
 assert.equal(nodes.get('settings-toggle').hidden,false);
 assert.equal(visible(),run('JSON.stringify(notes(cards[0].root,cards[0].q,cards[0].inv))'));
 let stopped=false;
 nodes.get('settings-toggle').handlers.click({stopPropagation(){stopped=true;}});
 assert.equal(stopped,true);assert.equal(run('running'),false);
 assert.equal(nodes.get('overlay').hidden,false);
 assert.equal(nodes.get('settings-toggle').hidden,true);
 documentHandlers.click();assert.equal(run('running'),false);
 nodes.get('overlay-action').handlers.click({stopPropagation(){}});
 assert.equal(run('running'),true);assert.equal(visible(),'[]');
 run('now=12000;render(now)');documentHandlers.click();
 assert.equal(visible(),run('JSON.stringify(notes(cards[1].root,cards[1].q,cards[1].inv))'));
 documentHandlers.click();assert.equal(run('running'),true);
 assert.equal(nodes.get('settings-toggle').hidden,true);
 assert.equal(visible(),'[]');
 assert.equal(documentHandlers.pointerup,undefined);
});
test('opening lead-in reveals first answer and reset clears pause UI',()=>{
 const {run,nodes}=session();run('play();now=1000;pause()');
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),3);
 run('reset()');
 assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),0);
 assert.equal(nodes.get('settings-toggle').hidden,true);
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
 run('play()');assert.equal(obscured(),'true');
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
 reload.run('play()');assert.equal(reload.nodes.get('keyboard').dataset.obscured,'true');
 assert.equal(stored.get('voicing-keyboard-blur'),'true');
});

test('phone mode hides keyboard during training and reveals answers without changing card spacing',()=>{
 const {run,nodes,documentHandlers}=session({navigator:{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'}});
 assert.equal(nodes.get('instrument').dataset.phone,'true');
 assert.equal(nodes.get('keyboard-blur-setting').hidden,true);
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
 run('play();render(now)');assert.equal(nodes.get('instrument').dataset.running,'true');
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
  assert.equal(nodes.get('keyboard-blur-setting').hidden,c.phone,c.ua);
 }
});


test('new users start with note recognition and pause reveals exactly its target key',()=>{
 const {run,nodes}=session({localStorage:{getItem(){return null;},setItem(){}}});
 assert.equal(run('stageIndex'),-1);
 assert.equal(nodes.get('note-range').hidden,false);
 assert.equal(run('cards.length'),36);
 run('play();now=10000;render(now);pause()');
 assert.equal(run('JSON.stringify([...answerDots].filter(([,dot])=>!dot.hidden).map(([midi])=>midi))'),run('JSON.stringify([cards[0].root])'));
 run('play()');assert.equal(run('[...answerDots.values()].filter(dot=>!dot.hidden).length'),0);
});
test('black key range resets, persists, and uses 15-question batches across boundaries',()=>{
 const stored=new Map();
 const localStorage={getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value)};
 const {run,nodes}=session({localStorage});
 nodes.get('note-black').checked=true;nodes.get('note-black').handlers.change();
 assert.equal(stored.get('voicing-note-black-only'),'true');
 assert.equal(nodes.get('note-all').checked,false);
 assert.equal(run('cards.length'),15);
 run('play();now=68000;render(now);pause()');
 assert.equal(run('completedBatches'),1);
 assert.ok(run('cards.length')>15);
 assert.equal(run('cards.every(c=>[1,3,6,8,10].includes(c.pc))'),true);
 assert.equal(run('JSON.stringify([...answerDots].filter(([,dot])=>!dot.hidden).map(([midi])=>midi))'),run('JSON.stringify([cards[15].root])'));
 const reload=session({localStorage});assert.equal(reload.nodes.get('note-black').checked,true);
 nodes.get('note-all').checked=true;nodes.get('note-all').handlers.change();
 assert.equal(run('cards.length'),36);assert.equal(run('sessionSeconds'),0);
 nodes.get('stage').value='0';nodes.get('stage').handlers.change();
 assert.equal(nodes.get('note-range').hidden,true);
 assert.equal(run('cards.every(c=>c.q===0&&c.inv===1)'),true);
});

function midiSession(extras={}){
 const input={id:'keyboard-a',name:'Test keyboard',state:'connected'};
 const access={inputs:new Map([[input.id,input]])};
 const app=session({isSecureContext:true,navigator:{async requestMIDIAccess(options){assert.equal(options.sysex,false);return access;}},...extras});
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
test('MIDI capability and permission failures stay recoverable without disrupting training',async()=>{
 for(const extras of [{isSecureContext:false},{navigator:{}},{navigator:{async requestMIDIAccess(){throw Object.assign(new Error(),{name:'NotAllowedError'});}}}]){
  const {run,nodes}=midiSession(extras);await run('connectMidi()');
  assert.match(nodes.get('midi-status').textContent,/HTTPS|未提供|未获允许/);
  assert.notEqual(nodes.get('midi-connect').disabled,true);
  run('play()');assert.equal(run('running'),true);
 }
 const {run,nodes}=midiSession();
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
 assert.ok(Number(run('elements[0].style.opacity'))<1);
 const pitches=JSON.parse(run('JSON.stringify(notes(cards[0].root,cards[0].q,cards[0].inv))'));
 send([0x90,pitches[0],100]);
 assert.equal(run('elements[0].dataset.feedback'),'correct');
 run('now=10000;render(now)');
 const opacity=Number(run('elements[0].style.opacity'));assert.ok(opacity>0&&opacity<1);
 send([0x90,pitches[1],100]);send([0x90,pitches[2],100]);
 assert.equal(Number(run('elements[0].style.opacity')),opacity);
 send([0x90,0,100]);
 assert.equal(run('elements[0].dataset.feedback'),'wrong');
 assert.equal(run('elements[0].style.opacity'),'1');
 send([0x90,pitches[0],100]);run('now=11999;render(now)');
 assert.equal(run('elements[0].dataset.feedback'),'wrong');
 assert.equal(run('elements[0].style.opacity'),'1');
 run('now=12000;render(now)');assert.equal(run('elements[0].hidden'),true);
 assert.equal(run('elements[1].dataset.feedback'),'waiting');
});

test('first wrong attack is sticky; note-off and pedal never judge; restart clears feedback',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('play();now=9000');
 send([0x80,0,100]);send([0x90,0,0]);send([0xb0,64,127]);
 assert.equal(run('cards[0].feedback'),undefined);
 send([0x90,0,100]);assert.equal(run('cards[0].feedback'),'wrong');
 send([0x90,run('cards[0].root'),100]);assert.equal(run('cards[0].feedback'),'wrong');
 run('reset()');assert.equal(run('cards[0].feedback'),undefined);
});

test('handoff grace ignores every attack on both sides at all supported tempos',async()=>{
 for(const tempo of [40,60,120]){
  const {run,send}=midiSession();await run('connectMidi()');run(`bpm=${tempo};play()`);
  const touch=720000/tempo;
  for(const offset of [-179,-1,0,1,179]){
   run(`now=${touch+offset}`);send([0x90,0,100]);
   assert.equal(run('cards[0].feedback'),undefined);
   assert.equal(run('cards[1].feedback'),undefined);
  }
  run(`now=${touch+181}`);send([0x90,0,100]);assert.equal(run('cards[1].feedback'),'wrong');
 }
});

test('single-note practice requires exact pitch, freezes while paused, and hides a faded label at handoff',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('stageIndex=-1;reset();play();now=8300');
 const root=run('cards[0].root');send([0x90,root,100]);
 assert.equal(run('cards[0].feedback'),'correct');
 run('now=10000;render(now);pause()');const opacity=run('elements[0].style.opacity');
 send([0x90,0,100]);run('now=70000;render(now)');
 assert.equal(run('elements[0].style.opacity'),opacity);assert.equal(run('cards[0].feedback'),'correct');
 run('play();now=71999;render(now)');assert.ok(Number(run('elements[0].style.opacity'))<.001);
 run('now=72000;render(now)');assert.equal(run('elements[0].hidden'),true);
 run('now=72300');send([0x90,run('cards[1].root')+12,100]);
 assert.equal(run('cards[1].feedback'),'wrong');
});

test('grace before next touch leaves prior judgment unchanged, and lead-in attacks do not count',async()=>{
 const {run,send}=midiSession();await run('connectMidi()');run('play();now=7000');send([0x90,0,100]);
 assert.equal(run('cards[0].feedback'),undefined);
 run('now=8000');send([0x90,run('cards[0].root'),100]);assert.equal(run('cards[0].feedback'),undefined);
 run('now=11819');send([0x90,run('cards[0].root'),100]);assert.equal(run('cards[0].feedback'),'correct');
 run('now=11821');send([0x90,0,100]);assert.equal(run('cards[0].feedback'),'correct');
});

 test('unplayed labels fade from touch until the next touch',()=>{
 const {run}=session();run('play();now=8000;render(now)');
 assert.equal(run('elements[0].style.opacity'),'1');
 run('now=10000;render(now)');assert.equal(run('elements[0].style.opacity'),'0.5');
 assert.equal(run('cards[0].feedback'),undefined);
 run('now=11999;render(now)');assert.ok(Number(run('elements[0].style.opacity'))<.001);
 run('now=12000;render(now)');assert.equal(run('elements[0].hidden'),true);
 assert.equal(run('elements[1].style.opacity'),'1');
 });
