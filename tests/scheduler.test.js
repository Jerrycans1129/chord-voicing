import test from 'node:test';import assert from 'node:assert/strict';
import {Scheduler} from '../dist/scheduler.js';
import {stages,trainingItems,positions} from '../dist/theory.js';
test('historical snapshot and session-specific weakness use the four grades',()=>{
 const stage=stages[0],id=trainingItems(stage)[0].id,history={[id]:[10,0,0,0]};
 const practice=new Scheduler(stage,{history}),challenge=new Scheduler(stage);
 assert.equal(practice.weight(id),12/14);assert.equal(challenge.weight(id),0);
 history[id][0]=0;assert.equal(practice.weight(id),12/14);
 for(const [score,expected] of [[.75,.125],[.5,.3125],[0,.65625],[1,.328125]]){
  challenge.record(id,score);assert.equal(challenge.levels.get(id),expected);
 }
 assert.equal(new Scheduler(stage).weight(id),0);
});
test('three review opportunities per ten with cooldown, legal octaves and balanced coverage',()=>{
 for(const stage of stages){
  const s=new Scheduler(stage,{history:{}}),seen=new Map(),balanced=new Set();
  let slots=0;
  for(let n=0;n<s.items.length*10;n++){
   const c=s.next();slots+=Number(c.reviewSlot);
   assert.ok(positions(c.pc,c.q,c.inv).includes(c.root));
   if(c.source==='review')assert.ok(n-(seen.get(c.id)??-Infinity)>=4);else balanced.add(c.id);
   seen.set(c.id,n);
  }
  assert.equal(slots,3*s.items.length);assert.equal(balanced.size,s.items.length);
 }
});
test('single legal position works even for four distinct selections sharing a bass',()=>{
 const items=stages.filter(s=>s.kind==='quality').flatMap(trainingItems).filter(i=>i.freeOctaves&&i.pc===1).slice(0,4);
 const s=new Scheduler({items},{history:{}});
 const seen=new Set();for(let i=0;i<100;i++){const card=s.next();assert.equal(card.root,49);seen.add(card.id);}
 assert.equal(seen.size,4);
});
