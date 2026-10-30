import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {stages,makeRound} from '../dist/theory.js';
function session(){
 const nodes=new Map();
 const element=()=>({style:{},dataset:{},hidden:false,textContent:'',value:'',clientHeight:300,append(){},replaceChildren(){},addEventListener(){},querySelector(){return this;}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 const context=vm.createContext({stages,makeRound,now:0,document:{getElementById:get,createElement:element,addEventListener(){}},localStorage:{getItem(){return null;},setItem(){}},performance:{now:()=>context.now},matchMedia:()=>({addEventListener(){}}),requestAnimationFrame(){}});
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
