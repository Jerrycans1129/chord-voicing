// Shared musical timeline and geometry. One progress unit is a 4/4 bar.
export const BEATS_PER_LABEL=4;
export const EARLY_BARS=1/32;
export const LABEL_HEIGHT=36;
export const EPSILON=1e-9;
export const barSeconds=bpm=>240/bpm;
export const earlySeconds=bpm=>barSeconds(bpm)*EARLY_BARS;
export function stopProgress(cards,mode){
 if(mode!=='practice')return Infinity;
 const index=cards.findIndex(card=>!card.practicePassed);
 return index<0?Infinity:index+3;
}
// Stop at input handovers as well as contact lines, before deciding passage.
export function motionStep(progress,seconds,bpm,stop=Infinity){
 const boundary=Math.min(Math.floor(progress+EPSILON)+1,Math.floor(progress+EARLY_BARS+EPSILON)+1-EARLY_BARS);
 let next=Math.min(progress+seconds/barSeconds(bpm),boundary,stop);
 if(Math.abs(next-Math.round(next))<EPSILON)next=Math.round(next);
 return {progress:next,movingSeconds:Math.max(0,(next-progress)*barSeconds(bpm)),frozen:next>=stop-EPSILON};
}
export function labelGeometry(index,progress,height,zoneHeight){
 const phase=progress-index,line=height-zoneHeight;
 const y=phase<2?-LABEL_HEIGHT-8+phase/2*(line+8):line-LABEL_HEIGHT+Math.min(1,phase-2)*zoneHeight;
 return {y,landed:phase>=2,hidden:phase<0};
}
// Never schedule past a possible practice freeze. The contact beat itself plays
// once, even if the sequence remains frozen for many frames.
export function metronomeBeats(progress,bpm,nextBeat,stop=Infinity,horizon=.12){
 const beat=progress*BEATS_PER_LABEL,period=60/bpm;
 let next=nextBeat??Math.ceil(beat-EPSILON);
 if(next<beat-.1)next=Math.ceil(beat-EPSILON);
 const events=[];
 while((next-beat)*period<horizon&&next<=stop*BEATS_PER_LABEL+EPSILON){
  events.push({beat:next,delay:Math.max(0,(next-beat)*period),accent:next%BEATS_PER_LABEL===0});next++;
 }
 return {events,nextBeat:next};
}
