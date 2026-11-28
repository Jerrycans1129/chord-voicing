import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Scheduler} from '../dist/scheduler.js';
import {stages,positions,trainingItems} from '../dist/theory.js';
function seeded(seed){
 let state=seed;
 return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
}
const runs=[];
for(const seed of [42,123456,20261101])for(const stage of stages)for(const practice of [false,true]){
 if(!practice&&stage.route==='learn')continue;
 const items=trainingItems(stage);
 const history=practice?Object.fromEntries(items.map((item,i)=>[item.id,i%2?[10,0,0,0]:[0,0,0,10]])):null;
 const s=new Scheduler(stage,{history,rng:seeded(seed)}),outcome=seeded(seed+1);
 const balanced=new Map(items.map(i=>[i.id,0])),lastSeen=new Map();
 let slots=0,reviews=0;
 for(let n=0;n<20000;n++){
  const card=s.next();slots+=Number(card.reviewSlot);
  assert.ok(positions(card.pc,card.q,card.inv).includes(card.root));
  if(card.source==='review'){reviews++;assert.ok(n-(lastSeen.get(card.id)??-Infinity)>=4);}
  else balanced.set(card.id,balanced.get(card.id)+1);
  lastSeen.set(card.id,n);
  const roll=outcome();s.record(card.id,roll<.05?0:roll<.15?.5:roll<.25?.75:1);
 }
 assert.equal(slots,6000);assert.ok(reviews>0);
 const counts=[...balanced.values()];assert.ok(Math.max(...counts)-Math.min(...counts)<=1);
 runs.push({stage:stage.id,seed,mode:practice?'practice':'challenge',cards:20000,reviews});
}
const report={assertions:'passed',totalGenerated:runs.length*20000,runs};
writeFileSync(new URL('../reports/scheduler-simulation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(report.totalGenerated+' cards passed');
