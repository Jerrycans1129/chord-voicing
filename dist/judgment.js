import {notes} from './theory.js';
export const GRACE_SECONDS=.18;
const EPS=1e-9;
export function prepareAttempt(card){return {...card,targets:card.kind==='note'?[card.root]:notes(card.root,card.q,card.inv),hits:new Set(),wrong:false,assisted:false,ended:false};}
// Stamp crossings in active seconds. A later BPM change cannot change a past
// crossing's 180ms trailing window. Pauses do not advance this clock.
export function stampBoundaries(cards,fromProgress,toProgress,fromSeconds,bpm){
 const secondsPerQuestion=240/bpm;
 cards.forEach((card,i)=>{
  if(card.startAt===undefined&&toProgress>=i+2)card.startAt=fromSeconds+(i+2-fromProgress)*secondsPerQuestion;
  if(card.endAt===undefined&&toProgress>=i+3)card.endAt=fromSeconds+(i+3-fromProgress)*secondsPerQuestion;
 });
}
export function attackTargets(cards,progress,seconds,bpm){
 const current=Math.floor(progress-2),next=current+1;
 const nearPrevious=current>=0&&cards[current]?.startAt!==undefined&&seconds-cards[current].startAt<=GRACE_SECONDS+EPS;
 const nearNext=(next+2-progress)*240/bpm<=GRACE_SECONDS+EPS;
 if(nearPrevious)return {indices:[current-1,current].filter(i=>i>=0&&cards[i]&&!cards[i].ended),tolerant:true};
 if(nearNext)return {indices:[current,next].filter(i=>i>=0&&cards[i]&&!cards[i].ended),tolerant:true};
 return {indices:current>=0&&cards[current]&&!cards[current].ended?[current]:[],tolerant:false};
}
export function applyAttack(card,note,tolerant){
 if(card.ended)return;
 if(card.targets.includes(note))card.hits.add(note);
 else if(!tolerant)card.wrong=true;
 card.feedback=card.wrong?'wrong':card.targets.every(n=>card.hits.has(n))?'correct':undefined;
}
export function isCorrect(card){return !card.wrong&&card.targets.every(n=>card.hits.has(n));}
export function canSettle(card,seconds){return !card.ended&&card.endAt!==undefined&&seconds>card.endAt+GRACE_SECONDS+EPS;}
