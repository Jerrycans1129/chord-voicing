import test from 'node:test';
import assert from 'node:assert/strict';
import {stages,curriculum,qualities,trainingItems,notes,positions,currentProgress} from '../dist/theory.js';
const perfect={best:{stars:3}};
test('only training nodes contribute to recommendations, in route order',()=>{
 assert.equal(qualities.length,20);
 assert.deepEqual(curriculum.map(p=>[p.learn.length,p.train.length]),[[1,4],[2,6],[3,1],[6,1],[0,2],[9,0]]);
 const results={};
 const training=stages.filter(s=>s.route==='train');
 for(const stage of training){
  assert.equal(stages[currentProgress(results)],stage);
  results[stage.id]=perfect;
 }
 assert.equal(stages[currentProgress(results)],training.at(-1));
});
test('five shape pools partition Level-2 by spelling and by physical voicing',()=>{
 const groups=curriculum[1].train.slice(0,5).map(trainingItems);
 assert.deepEqual(groups.map(items=>items.length),[30,18,12,24,18]);
 assert.deepEqual(groups.map(items=>new Set(items.map(i=>[i.pc,i.q,i.inv].join())).size),[24,12,12,12,12]);
 assert.deepEqual(groups.flat().map(i=>i.id).sort(),trainingItems(curriculum[1].train.at(-1)).map(i=>i.id).sort());
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
test('existing voicings and quality indices stay compatible',()=>{
 assert.deepEqual(notes(60,0,0),[60,64,67]);assert.deepEqual(notes(60,0,1),[52,55,60]);assert.deepEqual(notes(60,0,2),[55,60,64]);
 assert.deepEqual([1,2,3,0].map(inv=>notes(60,8,inv)),[[50,52,55,60],[52,55,60,62],[55,60,62,64],[60,62,64,67]]);
 assert.deepEqual(qualities.slice(0,9).map(q=>q.intervals),[[0,4,7],[0,3,7],[0,5,7],[0,2,7],[0,4,7,10],[0,3,7,10],[0,4,7,11],[0,5,7,10],[0,2,4,7]]);
});
test('comprehensive stages contain exactly their declared qualities',()=>{
 const levels=stages.filter(s=>s.comprehensive&&s.kind!=='note');
 assert.deepEqual(levels.map(s=>[...new Set(s.combos.map(c=>c.q))]),[[0,1],[4,5,6],[2,3,8,7,9,10],[0,1,4,5,6],[0,1,4,5,6,2,3,8,7,9,10]]);
 assert.deepEqual(levels.map(s=>s.id),['level-2','level-3-v2','level-4-v2','level-5-v2','level-6-v2']);
});
test('ninth chords have one free-octave node and roots only in the leftmost octave',()=>{
 for(const q of [11,12,13]){
  const node=stages.find(s=>s.id===`quality-${q}`);
  assert.equal(node.children,undefined);
  for(const item of trainingItems(node)){
   assert.equal(item.freeOctaves,true);assert.equal(item.inv,0);
   assert.deepEqual(positions(item.pc,item.q,item.inv),[48+item.pc]);
  }
 }
});
