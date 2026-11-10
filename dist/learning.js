import {qualities,names,notes} from './theory.js';
export const supportsLearning=node=>!!node&&!node.comprehensive&&!!node.combos?.length;
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
export function referenceNotes(q,pc,inv){
 let root=60+pc,pitches=notes(root,q,inv);
 while(pitches.at(-1)>84){root-=12;pitches=notes(root,q,inv);}
 while(pitches[0]<48){root+=12;pitches=notes(root,q,inv);}
 return pitches;
}
const degrees=[[0,2,4],[0,2,4],[0,3,4],[0,1,4],[0,2,4,6],[0,2,4,6],[0,2,4,6],[0,3,4,6],[0,1,2,4],[0,1,2,4],[0,2,4,5],[0,1,2,4,6],[0,1,2,4,6],[0,1,2,4,6],[0,2,4],[0,2,4,6],[0,2,4,6],[0,2,4],[0,2,4,5],[0,2,4,6]];
export function learningChordName(q,pc,spelling,inv){
 const root=names[pc][spelling]??names[pc][0],symbol=root+qualities[q].suffix;
 if(!inv)return symbol;
 const letters='CDEFGAB',natural=[0,2,4,5,7,9,11];
 const letter=(letters.indexOf(root[0])+degrees[q][inv])%7;
 let offset=((pc+qualities[q].intervals[inv]-natural[letter])%12+12)%12;if(offset>6)offset-=12;
 const bass=letters[letter]+(offset<0?'♭'.repeat(-offset):'♯'.repeat(offset));
 return `${symbol} / ${bass}`;
}
