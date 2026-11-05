import {notes} from './theory.js';
export const WINDOW_ADVANCE_SECONDS=.18;
export const JUDGMENT_POLICY='advance-180ms';
const EPS=1e-9;
export function prepareAttempt(card){return {...card,targets:card.kind==='note'?[card.root]:notes(card.root,card.q,card.inv),hits:new Set(),wrong:false,assisted:false,ended:false};}
// Commit each shifted boundary once, in active training seconds. A tempo change
// may move a future boundary, but can never reopen or backdate a committed one.
export function stampBoundaries(cards,fromProgress,toProgress,fromSeconds,bpm,advanceSeconds=WINDOW_ADVANCE_SECONDS){
 const period=240/bpm;
 const boundaryAt=boundary=>Math.max(fromSeconds,fromSeconds+(boundary-fromProgress)*period-advanceSeconds);
 cards.forEach((card,i)=>{
  if(card.startAt===undefined&&toProgress+advanceSeconds/period+EPS>=i+2)card.startAt=boundaryAt(i+2);
  if(card.endAt===undefined&&toProgress+advanceSeconds/period+EPS>=i+3)card.endAt=boundaryAt(i+3);
 });
}
export function activeQuestionIndex(cards,seconds){
 return cards.findLastIndex(card=>!card.ended&&card.startAt!==undefined&&seconds+EPS>=card.startAt&&(card.endAt===undefined||seconds+EPS<card.endAt));
}
export function attackTargets(cards,seconds){
 const index=activeQuestionIndex(cards,seconds);
 return {indices:index<0?[]:[index]};
}
export function targetForNote(card,note){
 if(!card.freeOctaves)return card.targets.includes(note)?note:undefined;
 // The bass root is exact. Every other chord tone is octave-independent.
 return card.targets.find(pitch=>pitch===card.root?note===pitch:note%12===pitch%12);
}
export function applyAttack(card,note){
 if(card.ended)return;
 const target=targetForNote(card,note);
 if(card.targets.includes(target))card.hits.add(target);
 else card.wrong=true;
 card.feedback=card.wrong?'wrong':card.targets.every(n=>card.hits.has(n))?'correct':undefined;
}
export function isCorrect(card){return !card.wrong&&card.targets.every(n=>card.hits.has(n));}
export function canSettle(card,seconds){return !card.ended&&card.endAt!==undefined&&seconds+EPS>=card.endAt;}
