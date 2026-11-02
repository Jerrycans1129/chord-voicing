import test from 'node:test';import assert from 'node:assert/strict';
import {stages,curriculum,qualities,trainingItems,notes,positions,selectable,currentProgress,migrateResults} from '../dist/theory.js';
const perfect={best:{stars:3}};
test('tree has 47 trainable nodes and postorder covers leaves before independent parents',()=>{
 assert.equal(stages.length,47);assert.equal(qualities.length,9);
 assert.deepEqual(stages.slice(0,5).map(s=>s.pcs),[[1,3],[6,8,10],[1,3,6,8,10],[0,2,4,5,7,9,11],Array.from({length:12},(_,i)=>i)]);
 const results={};assert.equal(currentProgress(results),0);assert.equal(selectable(curriculum[2],results),false);
 for(let i=0;i<stages.length;i++){
  assert.equal(currentProgress(results),i);assert.equal(selectable(stages[i],results),true);
  results[stages[i].id]=perfect;
 }
 assert.equal(currentProgress(results),46);
 assert.equal(trainingItems(stages.at(-1)).length,544);
});
test('all voicings are sorted, unique, close-position and fit C3–C6 for every spelling',()=>{
 for(const stage of stages){
  const items=trainingItems(stage);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  for(const i of items){
   const roots=positions(i.pc,i.q,i.inv);assert.ok(roots.length);
   for(const root of roots){
    const pitches=i.kind==='note'?[root]:notes(root,i.q,i.inv);
    assert.ok(pitches.every(n=>n>=48&&n<=84));assert.deepEqual(pitches,[...pitches].sort((a,b)=>a-b));
    assert.equal(new Set(pitches).size,pitches.length);assert.ok(pitches.at(-1)-pitches[0]<12);
   }
  }
 }
});
test('add9 has four complete root positions and legacy triads remain identical',()=>{
 assert.deepEqual(notes(60,0,0),[60,64,67]);assert.deepEqual(notes(60,0,1),[52,55,60]);assert.deepEqual(notes(60,0,2),[55,60,64]);
 assert.deepEqual([1,2,3,0].map(inv=>notes(60,8,inv)),[[50,52,55,60],[52,55,60,62],[55,60,62,64],[60,62,64,67]]);
 assert.deepEqual(qualities.map(q=>q.intervals),[[0,4,7],[0,3,7],[0,5,7],[0,2,7],[0,4,7,10],[0,3,7,10],[0,4,7,11],[0,5,7,10],[0,2,4,7]]);
});
test('parents require every direct child and mixed results do not complete children',()=>{
 const results={'notes-all':perfect};assert.equal(selectable(curriculum[0],results),false);assert.equal(currentProgress(results),0);
 for(const child of curriculum[0].children)results[child.id]=perfect;
 assert.equal(selectable(curriculum[0],results),true);assert.equal(currentProgress(results),5);
 assert.equal(selectable(stages.find(s=>s.id==='chord-8-3'),{}),true);
});
test('only semantically identical old mixed scores migrate',()=>{
 const saved={'mix-0-0':perfect,'mix-1-0':perfect,'mix-2-0':perfect};const migrated=migrateResults(saved);
 assert.equal(migrated['quality-0'],perfect);assert.equal(migrated['quality-1'],undefined);assert.equal(migrated['chords-all'],undefined);
});
