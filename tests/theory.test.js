import test from 'node:test';import assert from 'node:assert/strict';
import {stages,trainingItems,notes,positions,initialStage} from '../dist/theory.js';
test('22-stage route starts with specified note groups and accumulates only learned voicings',()=>{
 assert.equal(stages.length,22);
 assert.deepEqual(stages.slice(0,5).map(s=>s.pcs),[[1,3],[6,8,10],[1,3,6,8,10],[0,2,4,5,7,9,11],Array.from({length:12},(_,i)=>i)]);
 const learned=[];
 for(const stage of stages.slice(5)){
  if(!stage.mixed)learned.push(...stage.combos);
  else assert.deepEqual(stage.combos,learned);
 }
 assert.deepEqual(learned,[0,1,2].flatMap(q=>[1,2,0].map(inv=>({q,inv}))));
 assert.equal(stages[21].combos.length,9);
});
test('both spellings are independent items in every stage and all positions fit the keyboard',()=>{
 assert.deepEqual(stages.slice(0,5).map(s=>trainingItems(s).length),[4,6,10,7,17]);
 for(const stage of stages){
  const items=trainingItems(stage);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  for(const i of items){
   const roots=positions(i.pc,i.q,i.inv);assert.ok(roots.length);
   for(const root of roots){assert.equal(root%12,i.pc);assert.ok((i.kind==='note'?[root]:notes(root,i.q,i.inv)).every(n=>n>=48&&n<=84));}
  }
 }
 assert.equal(trainingItems(stages[21]).length,153);
 assert.deepEqual(positions(0),[48,60,72,84]);
});
test('close-position voicings and legacy preferences migrate without reinterpreting progress',()=>{
 assert.deepEqual(notes(60,0,0),[60,64,67]);assert.deepEqual(notes(60,0,1),[52,55,60]);assert.deepEqual(notes(60,0,2),[55,60,64]);
 assert.equal(initialStage(null,null),0);assert.equal(initialStage(null,0),5);
 assert.equal(initialStage(null,-1,true),2);assert.equal(initialStage(null,-1,false),4);
 assert.equal(initialStage('notes-white',0),3);assert.equal(initialStage('unknown',999),0);
});
