import {qualities} from './theory.js';
export class ChordRecognizer {
 constructor(q){this.q=q;this.reset();}
 reset(){this.candidates=Array.from({length:12},(_,pc)=>({pc,tones:new Set(qualities[this.q].intervals.map(n=>(n+pc)%12)),hits:new Set(),bass:Infinity}));}
 attack(note,held=[],preferred=0,rng=Math.random){
  const matches=[];
  for(const c of this.candidates){
   if(!c.tones.has(note%12)){c.hits.clear();c.bass=Infinity;continue;}
   c.hits.add(note%12);c.bass=Math.min(c.bass,note);
   if(c.hits.size===c.tones.size&&!held.some(n=>!c.tones.has(n%12)))matches.push(c);
  }
  if(!matches.length)return null;
  const c=matches.find(c=>c.pc===preferred)??matches[Math.floor(rng()*matches.length)];
  const inv=qualities[this.q].intervals.findIndex(n=>(c.pc+n)%12===c.bass%12);
  const result={pc:c.pc,inv};this.reset();return result;
 }
}

// Each quality keeps its own progress so a triad can grow into a seventh chord.
export class LevelRecognizer {
 constructor(kinds){this.recognizers=kinds.map(q=>new ChordRecognizer(q));}
 reset(){this.pending=null;for(const recognizer of this.recognizers)recognizer.reset();}
 attack(note,held,pc,preferredQuality){
  const matches=[];
  const heldPitches=new Set(held.map(n=>n%12));
  for(const recognizer of this.recognizers){
   // Shared notes can stay down while a player changes just one chord tone.
   for(const candidate of recognizer.candidates){
    if(candidate.tones.size!==heldPitches.size||!held.every(n=>candidate.tones.has(n%12)))continue;
    candidate.hits=new Set(heldPitches);candidate.bass=Math.min(...held);
   }
   const match=recognizer.attack(note,held,pc);
   if(match)matches.push({...match,q:recognizer.q});
  }
  const completeInHand=match=>qualities[match.q].intervals.length===heldPitches.size;
  matches.sort((a,b)=>Number(completeInHand(b))-Number(completeInHand(a))
   ||qualities[b.q].intervals.length-qualities[a.q].intervals.length
   ||Number(b.q===preferredQuality)-Number(a.q===preferredQuality)
   ||Number(b.pc===pc)-Number(a.pc===pc));
  return matches[0]??null;
 }
}
