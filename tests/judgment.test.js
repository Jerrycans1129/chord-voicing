import test from 'node:test';import assert from 'node:assert/strict';
import {prepareAttempt,stampBoundaries,attackTargets,applyAttack,isCorrect,canSettle,activeQuestionIndex} from '../dist/judgment.js';
import {earlySeconds} from '../dist/performance.js';
function pair(){return [prepareAttempt({kind:'chord',root:60,q:0,inv:0}),prepareAttempt({kind:'chord',root:57,q:1,inv:0})];}
test('arpeggios accumulate every target; later wrong notes are sticky',()=>{
 const [c]=pair();assert.equal(isCorrect(c),false);applyAttack(c,67);applyAttack(c,60);applyAttack(c,60);assert.equal(isCorrect(c),false);
 applyAttack(c,64);assert.equal(isCorrect(c),true);applyAttack(c,61);assert.equal(isCorrect(c),false);assert.equal(c.feedback,'wrong');applyAttack(c,64);assert.equal(c.feedback,'wrong');
});
test('visual boundaries switch once, including at every practice tempo',()=>{
 for(const bpm of [90,91,120,137,180])for(const delta of [-.181,-.001,0,.001,.18]){
  const cards=pair(),seconds=3*240/bpm-earlySeconds(bpm)+delta;
  stampBoundaries(cards,0,seconds*bpm/240,0,bpm);
  const index=delta<0?0:1;assert.deepEqual(attackTargets(cards,seconds).indices,[index]);
  applyAttack(cards[index],60);assert.equal(cards[1-index].hits.size,0);
  applyAttack(cards[index],66);assert.equal(cards[index].wrong,true);
  assert.equal(canSettle(cards[0],seconds),index===1);
 }
});
test('lead-in ignores attacks before touch, start is inclusive and bottom exclusive',()=>{
 const cards=pair();stampBoundaries(cards,0,4,0,60);
 assert.equal(cards[0].startAt,7.875);assert.equal(cards[0].endAt,11.875);
 assert.deepEqual(attackTargets(cards,7.874).indices,[]);
 assert.deepEqual(attackTargets(cards,7.875).indices,[0]);
 assert.deepEqual(attackTargets(cards,11.875).indices,[1]);
 cards[0].ended=true;applyAttack(cards[0],60);assert.equal(cards[0].hits.size,0);
});
test('committed boundaries cannot move after practice tempo changes',()=>{
 const cards=pair();stampBoundaries(cards,0,3,0,60);cards[0].ended=true;
 stampBoundaries(cards,3,3,12,40);assert.equal(cards[0].endAt,11.875);
 assert.equal(activeQuestionIndex(cards,11.875),1);
});
test('delayed frames stamp every ended question and settle once',()=>{
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
