import test from 'node:test';import assert from 'node:assert/strict';
import {Scheduler,cleanLevels} from '../dist/scheduler.js';
import {stages,positions} from '../dist/theory.js';
const rng=()=>{let n=123456;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};};
test('mistakes are spelling-, quality-, and inversion-specific, but shared across octaves and stages',()=>{
 const levels=cleanLevels({});const s=new Scheduler(stages.find(s=>s.id==='level-6-v2'),{levels,rng:rng()});
 const id='chord:D♭:1:1';s.record(id,'wrong');s.record(id,'wrong');s.record(id,'wrong');s.record(id,'wrong');
 assert.equal(levels[id],3);assert.equal(levels['chord:C♯:1:1'],undefined);assert.equal(levels['chord:D♭:1:2'],undefined);assert.equal(levels['chord:D♭:0:1'],undefined);
 assert.equal(s.record(id,'correct'),true);assert.equal(levels[id],2);s.record(id,'wrong');
 const later=new Scheduler(stages[10],{levels,rng:rng()});assert.equal(later.levels[id],3);
 const roots=new Set();for(let i=0;i<2000;i++){const c=s.next();if(c.source==='review'){assert.equal(c.id,id);assert.equal(c.name,'D♭');roots.add(c.root);}}
 assert.deepEqual([...roots].sort(),positions(1,1,1));
});
test('note successes lower levels, unknown does not, storage is validated and levels capped',()=>{
 const levels=cleanLevels({'note:C♯':3,'note:D♭':-1,'note:A':99,'note:B':'2',oops:1});
 const s=new Scheduler(stages[0],{levels});assert.deepEqual({...levels},{'note:C♯':3});
 s.record('note:C♯','unknown');assert.equal(levels['note:C♯'],3);
 s.record('note:C♯','correct');assert.equal(levels['note:C♯'],2);
 s.record('note:C♯','correct');s.record('note:C♯','correct');s.record('note:C♯','correct');assert.equal(levels['note:C♯'],undefined);
 assert.equal(s.record('note:A','wrong'),false);
});
test('every ten slots contain three review opportunities, cooldown enforces three intervening cards',()=>{
 const levels=cleanLevels({'note:C♯':3});const s=new Scheduler(stages[0],{levels,rng:rng()});
 let last=-Infinity,reviews=0,fallbacks=0;
 for(let block=0;block<1000;block++){
  let slots=0;for(let j=0;j<10;j++){
   const i=block*10+j,c=s.next();slots+=Number(c.reviewSlot);
   if(c.source==='review'){assert.equal(c.id,'note:C♯');assert.ok(i-last>=4);reviews++;}
   if(c.reviewSlot&&c.source==='balanced')fallbacks++;
   if(c.id==='note:C♯')last=i;
  }assert.equal(slots,3);
 }
 assert.ok(reviews>0);assert.ok(fallbacks>0);
});
test('balanced source covers every spelling equally and every item visits all legal octaves',()=>{
 for(const stage of stages){
  const s=new Scheduler(stage,{rng:rng()}),counts=new Map(),roots=new Map();
  for(let i=0;i<s.items.length*20;i++){
   const c=s.next();assert.equal(c.source,'balanced');counts.set(c.id,(counts.get(c.id)||0)+1);
   if(!roots.has(c.id))roots.set(c.id,new Set());roots.get(c.id).add(c.root);
  }
  assert.equal(counts.size,s.items.length);for(const pool of s.pools){
   const values=pool.map(item=>counts.get(item.id));assert.ok(Math.max(...values)-Math.min(...values)<=1);
  }
  for(const item of s.items)assert.deepEqual([...roots.get(item.id)].sort(),positions(item.pc,item.q,item.inv));
 }
});

test('mixed levels enforce five current and five earlier cards despite concentrated weakness',()=>{
 for(const stage of stages.filter(s=>s.pools)){
  const levels=Object.fromEntries(stage.pools[0].map(c=>[`chord:C:${c.q}:${c.inv}`,3]));
  const s=new Scheduler(stage,{levels,rng:rng()}),current=new Set(stage.pools[0].map(c=>c.q));
  let reviews=0;
  for(let block=0;block<100;block++){
   let currentCount=0,slots=0;
   for(let n=0;n<10;n++){const card=s.next();currentCount+=Number(current.has(card.q));slots+=Number(card.reviewSlot);if(card.source==='review')reviews++;}
   assert.equal(currentCount,5);assert.equal(slots,3);
  }
  assert.ok(reviews>0);
 }
});


test('shared scheduler never repeats a physical label key, including enharmonic spellings',()=>{
 for(const stage of stages){
  const items=new Scheduler(stage).items;
  const scheduler=new Scheduler(stage,{rng:rng(),levels:Object.fromEntries(items.map(item=>[item.id,3]))});
  let previous=null;
  for(let i=0;i<1000;i++){
   const card=scheduler.next();assert.notEqual(card.root,previous);
   assert.ok(positions(card.pc,card.q,card.inv).includes(card.root));previous=card.root;
  }
 }
});
