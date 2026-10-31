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
