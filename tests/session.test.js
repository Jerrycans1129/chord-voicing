import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stages,makeRound} from '../dist/theory.js';
function session(extras={}){
 const nodes=new Map();
 const element=()=>({style:{setProperty(key,value){this[key]=value;}},dataset:{},hidden:false,textContent:'',value:'',clientHeight:300,setAttribute(){},append(){},replaceChildren(){},addEventListener(){},querySelector(){return this;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({stages,makeRound,now:0,document:{getElementById:get,createElement:element,addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},performance:{now:()=>context.now},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame(){},...extras});
 vm.runInContext(readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\n/,''),context);
 return {run:code=>vm.runInContext(code,context),nodes};
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
 const top=y();run('now=250;render(now)');const first=y();
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
