import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stages,makeRound,notes} from '../dist/theory.js';
function session(extras={}){
 const nodes=new Map(),documentHandlers={};
 const element=()=>({style:{setProperty(key,value){this[key]=value;}},dataset:{},hidden:false,textContent:'',value:'',clientHeight:300,setAttribute(){},append(){},replaceChildren(){},handlers:{},addEventListener(type,fn){this.handlers[type]=fn;},querySelector(){return this;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({stages,makeRound,notes,now:0,document:{getElementById:get,createElement:element,addEventListener(type,fn){documentHandlers[type]=fn;}},localStorage:{getItem(){return null;},setItem(){}},performance:{now:()=>context.now},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame(){},...extras});
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
