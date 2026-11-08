import {notes} from './theory.js';
import {earlySeconds,EARLY_BARS,EPSILON} from './performance.js';
export const JUDGMENT_POLICY='early-thirty-second-note';
const EPS=1e-9;
export function prepareAttempt(card){return {...card,targets:card.kind==='note'?[card.root]:notes(card.root,card.q,card.inv),hits:new Set(),wrong:false,assisted:false,ended:false};}
// Commit each shifted boundary once, in active training seconds. A tempo change
// may move a future boundary, but can never reopen or backdate a committed one.
export function stampBoundaries(cards,fromProgress,toProgress,fromSeconds,bpm,advanceSeconds=earlySeconds(bpm)){
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

// Training errors are recoverable; the latest complete attempt determines color.
export function applyPracticeAttack(card,note,held=[]){
 const target=targetForNote(card,note);
 if(target===undefined){card.hits.clear();card.wrong=true;card.feedback='wrong';return;}
 card.hits.add(target);
 if(card.targets.every(n=>card.hits.has(n))){
  card.wrong=held.some(n=>targetForNote(card,n)===undefined);
  card.feedback=card.wrong?'wrong':'correct';
 }
}
export function practiceBlockedIndex(cards){
 return cards.findIndex(card=>card.practiceClosed&&!card.practicePassed);
}
export function updatePracticeState(cards,progress){
 const blocked=practiceBlockedIndex(cards);
 if(blocked>=0){
  const card=cards[blocked];
  if(progress>=blocked+3-EPSILON&&!card.practiceRetryStarted){
   card.practiceRetryStarted=true;
   card.hits.clear();
   const next=cards[blocked+1];
   if(next){next.hits.clear();next.wrong=false;next.feedback=undefined;next.startAt=undefined;}
  }
  return;
 }
 for(let i=0;i<cards.length;i++){
  const card=cards[i];
  if(!card.practiceClosed&&progress>=i+3-EARLY_BARS-EPSILON){
   card.practiceClosed=true;card.practicePassed=isCorrect(card);
   if(!card.practicePassed){card.feedback='wrong';break;}
  }
 }
}
export function practiceAttackTargets(cards,progress,seconds){
 const blocked=practiceBlockedIndex(cards);
 if(blocked<0)return attackTargets(cards,seconds).indices;
 // The small gap before bottom contact deliberately ignores all input.
 if(progress<blocked+3-EPSILON)return [];
 const recovery=cards[blocked].retryBeats;
 if(recovery!==undefined)return recovery>=4-EARLY_BARS*4-EPSILON?[blocked+1]:[];
 return [blocked];
}
export function applyPracticeInput(cards,progress,seconds,note,held=[]){
 const blocked=practiceBlockedIndex(cards);
 for(const index of practiceAttackTargets(cards,progress,seconds)){
  const card=cards[index];if(!card)continue;
  applyPracticeAttack(card,note,held);
  if(blocked>=0&&index===blocked&&isCorrect(card)){
   card.retryBeats=0;card.fadeAt=seconds;card.feedback='wrong';
   return;
  }
 }
}
