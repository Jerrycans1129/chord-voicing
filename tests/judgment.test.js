import test from 'node:test';import assert from 'node:assert/strict';
import {prepareAttempt,stampBoundaries,attackTargets,applyAttack,isCorrect,canSettle} from '../dist/judgment.js';
function pair(){return [prepareAttempt({kind:'chord',root:60,q:0,inv:0}),prepareAttempt({kind:'chord',root:57,q:1,inv:0})];}
test('arpeggios accumulate every target in any order; partial and silent responses are not correct',()=>{
 const [c]=pair();assert.equal(isCorrect(c),false);applyAttack(c,67,false);applyAttack(c,60,false);applyAttack(c,60,false);assert.equal(isCorrect(c),false);assert.equal(c.feedback,undefined);
 applyAttack(c,64,false);assert.equal(isCorrect(c),true);applyAttack(c,61,false);assert.equal(isCorrect(c),false);assert.equal(c.feedback,'wrong');applyAttack(c,64,true);assert.equal(c.feedback,'wrong');
});
test('overlap credits both questions and tolerates non-target notes at all five tempos',()=>{
 for(const bpm of [40,60,90,120,140])for(const delta of [-.18,-.179,0,.179,.18]){
  const cards=pair(),seconds=3*240/bpm+delta,progress=seconds*bpm/240;stampBoundaries(cards,0,progress,0,bpm);
  const target=attackTargets(cards,progress,seconds,bpm);assert.deepEqual(target,{indices:[0,1],tolerant:true});
  for(const note of [60,64,67,57,66])for(const i of target.indices)applyAttack(cards[i],note,target.tolerant);
  assert.ok(cards.every(isCorrect));assert.ok(cards.every(c=>!c.wrong));
 }
});
test('outside overlap wrong notes affect only current question; old errors are sticky',()=>{
 for(const [delta,index] of [[-.181,0],[.181,1]]){
  const cards=pair(),seconds=12+delta;stampBoundaries(cards,0,seconds/4,0,60);
  const target=attackTargets(cards,seconds/4,seconds,60);assert.deepEqual(target,{indices:[index],tolerant:false});applyAttack(cards[index],66,false);assert.equal(cards[index].wrong,true);assert.equal(cards[1-index].wrong,false);
 }
});
test('settlement waits for trailing grace and BPM changes cannot shorten it',()=>{
 const cards=pair();stampBoundaries(cards,0,3,0,60);assert.equal(cards[0].endAt,12);
 assert.equal(canSettle(cards[0],12.18),false);assert.equal(canSettle(cards[0],12.181),true);
 stampBoundaries(cards,3,3.05,12,140);assert.equal(cards[0].endAt,12);
 const target=attackTargets(cards,3.05,12+.05*240/140,140);assert.deepEqual(target.indices,[0,1]);
});
test('lead-in only accepts early correct notes near the first touch, no false errors',()=>{
 const cards=pair();assert.deepEqual(attackTargets(cards,1,4,60).indices,[]);
 const target=attackTargets(cards,7.9/4,7.9,60);assert.deepEqual(target,{indices:[0],tolerant:true});
 applyAttack(cards[0],60,true);applyAttack(cards[0],66,true);assert.equal(cards[0].wrong,false);
});
