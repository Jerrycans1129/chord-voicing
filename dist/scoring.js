export const VERSION='0.2.0';
export const SPEEDS=[{bpm:40,name:'很慢',factor:.70},{bpm:60,name:'慢',factor:.85},{bpm:90,name:'标准',factor:1},{bpm:120,name:'快',factor:1},{bpm:140,name:'很快',factor:1}];
export const TOTAL_SECONDS=1800;
export function normalizeBpm(value){
 const number=Number(value);if(!Number.isFinite(number)||number<=0)return 90;
 return SPEEDS.reduce((best,s)=>Math.abs(s.bpm-number)<Math.abs(best-number)?s.bpm:best,90);
}
export function starsFor(score){
 if(score<=0)return 0;
 return score>=90?3:score>=75?2.5:score>=60?2:score>=40?1.5:score>=20?1:.5;
}
export function createRun(){return {started:false,seconds:0,total:0,correct:0,paused:false,shownKeyboard:false,minBpm:null};}
export function recordConditions(run,{seconds,bpm,visible=false,paused=false}){
 if(!run.started)return;
 if(seconds>0){run.seconds=Math.min(TOTAL_SECONDS,run.seconds+seconds);run.minBpm=Math.min(run.minBpm??Infinity,bpm);}
 if(visible)run.shownKeyboard=true;
 if(paused)run.paused=true;
}
export function calculateScore(run){
 if(!run.started)return null;
 const accuracy=run.total>0?run.correct/run.total:0;
 const factors={pause:run.paused?.95:1,keyboard:run.shownKeyboard?.90:1,speed:SPEEDS.find(s=>s.bpm===run.minBpm)?.factor??1,duration:Math.max(0,Math.min(1,run.seconds/TOTAL_SECONDS))};
 // No rounding until display: 89.999... must never become a 3-star result.
 const score=100*accuracy*factors.pause*factors.keyboard*factors.speed*factors.duration;
 return {...run,accuracy,factors,score,stars:starsFor(score)};
}
export function cleanResults(value,stageIds){
 const results=Object.create(null);
 for(const id of stageIds){
  const saved=value?.[id];if(!saved)continue;
  const valid=r=>r&&r.started===true&&Number.isFinite(r.seconds)&&r.seconds>=0&&r.seconds<=TOTAL_SECONDS&&Number.isInteger(r.total)&&r.total>=0&&Number.isInteger(r.correct)&&r.correct>=0&&r.correct<=r.total&&(r.minBpm===null||SPEEDS.some(s=>s.bpm===r.minBpm))&&typeof r.paused==='boolean'&&typeof r.shownKeyboard==='boolean';
  if(valid(saved.last)&&valid(saved.best))results[id]={last:calculateScore(saved.last),best:calculateScore(saved.best)};
 }
 return results;
}
