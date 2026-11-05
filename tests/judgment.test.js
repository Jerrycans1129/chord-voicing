import test from 'node:test';import assert from 'node:assert/strict';
import {prepareAttempt,stampBoundaries,attackTargets,applyAttack,isCorrect,canSettle,activeQuestionIndex} from '../dist/judgment.js';
function pair(){return [prepareAttempt({kind:'chord',root:60,q:0,inv:0}),prepareAttempt({kind:'chord',root:57,q:1,inv:0})];}
test('arpeggios accumulate every target; later wrong notes are sticky',()=>{
 const [c]=pair();assert.equal(isCorrect(c),false);applyAttack(c,67);applyAttack(c,60);applyAttack(c,60);assert.equal(isCorrect(c),false);
 applyAttack(c,64);assert.equal(isCorrect(c),true);applyAttack(c,61);assert.equal(isCorrect(c),false);assert.equal(c.feedback,'wrong');applyAttack(c,64);assert.equal(c.feedback,'wrong');
});
test('every tempo switches once at -180ms, with no overlap or immunity',()=>{
 for(const bpm of [40,60,90,120,140])for(const delta of [-.181,-.18,-.179,0,.179,.18]){
  const cards=pair(),seconds=3*240/bpm+delta,progress=seconds*bpm/240;
  stampBoundaries(cards,0,progress,0,bpm);
  const index=delta<-.18?0:1,target=attackTargets(cards,seconds);assert.deepEqual(target,{indices:[index]});
  applyAttack(cards[index],60);assert.equal(cards[index].hits.has(60),true);assert.equal(cards[1-index].hits.size,0);
  applyAttack(cards[index],66);assert.equal(cards[index].wrong,true);assert.equal(cards[1-index].wrong,false);
  assert.equal(canSettle(cards[0],seconds),index===1);
 }
});
test('first window starts early and immediately counts incorrect notes',()=>{
 const cards=pair();stampBoundaries(cards,0,7.819/4,0,60);assert.deepEqual(attackTargets(cards,7.819).indices,[]);
 stampBoundaries(cards,7.819/4,7.82/4,7.819,60);assert.deepEqual(attackTargets(cards,7.82).indices,[0]);
 applyAttack(cards[0],66);assert.equal(cards[0].wrong,true);
});
test('fixed tempo windows preserve duration and use inclusive start, exclusive end',()=>{
 const cards=pair();stampBoundaries(cards,0,4,0,60);
 assert.equal(cards[0].startAt,7.82);assert.equal(cards[0].endAt,11.82);assert.equal(cards[1].startAt,11.82);
 assert.equal(cards[0].endAt-cards[0].startAt,4);
 assert.equal(canSettle(cards[0],11.819),false);assert.equal(canSettle(cards[0],11.82),true);
 cards[0].ended=true;applyAttack(cards[0],60);assert.equal(cards[0].hits.size,0);
});
test('slowing down after a committed boundary never reopens the previous question',()=>{
 const cards=pair();stampBoundaries(cards,0,11.83/4,0,60);cards[0].ended=true;
 stampBoundaries(cards,11.83/4,11.83/4,11.83,40);
 assert.equal(cards[0].endAt,11.82);assert.equal(cards[1].startAt,11.82);assert.equal(activeQuestionIndex(cards,11.83),1);
 stampBoundaries(cards,11.83/4,3.5,11.83,40);assert.equal(cards[0].endAt,11.82);
});
test('speeding up can commit a boundary now but never backdate it',()=>{
 const cards=pair();stampBoundaries(cards,0,11.7/4,0,60);
 stampBoundaries(cards,11.7/4,11.7/4,11.7,140);
 assert.equal(cards[0].endAt,11.7);assert.equal(cards[1].startAt,11.7);assert.equal(activeQuestionIndex(cards,11.7),1);
});
test('delayed frames stamp every ended question and settle only once',()=>{
 const cards=Array.from({length:10},()=>pair()[0]);stampBoundaries(cards,0,8,0,60);
 const ended=cards.filter(c=>canSettle(c,32));assert.equal(ended.length,6);
 for(const c of ended)c.ended=true;
 assert.equal(cards.filter(c=>canSettle(c,32)).length,0);assert.equal(activeQuestionIndex(cards,32),6);
});

test('ninth chords require the exact bass root and every other pitch class in any octave',()=>{
 for(const q of [11,12,13]){
  const card=prepareAttempt({kind:'chord',root:49,q,inv:0,freeOctaves:true});
  const other=card.targets.slice(1).reverse();
  other.forEach((pitch,i)=>applyAttack(card,pitch+12*(i%3)));
  assert.equal(isCorrect(card),false);
  applyAttack(card,49);assert.equal(isCorrect(card),true);
  const highRoot=prepareAttempt({kind:'chord',root:49,q,inv:0,freeOctaves:true});
  applyAttack(highRoot,61);assert.equal(highRoot.wrong,true);assert.equal(highRoot.hits.size,0);
  const incomplete=prepareAttempt({kind:'chord',root:49,q,inv:0,freeOctaves:true});
  for(const pitch of incomplete.targets.slice(0,4))applyAttack(incomplete,pitch);
  applyAttack(incomplete,incomplete.targets[1]+12);assert.equal(isCorrect(incomplete),false);
  applyAttack(incomplete,54);assert.equal(incomplete.wrong,true);
 }
});
