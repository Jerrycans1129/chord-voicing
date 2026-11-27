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
