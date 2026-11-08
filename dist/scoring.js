export const VERSION='0.2.0';
export const TOTAL_SECONDS=1800;
export function normalizeBpm(value){
 const number=Number(value);
 return Number.isFinite(number)?Math.max(90,Math.min(180,Math.round(number))):90;
}
export function starsFor(score){
 if(score<=0)return 0;
 return score>=90?3:score>=75?2.5:score>=60?2:score>=40?1.5:score>=20?1:.5;
}
export function createRun(){return {started:false,seconds:0,total:0,correct:0,failed:false};}
export function recordConditions(run,{seconds=0}){
 if(run.started&&seconds>0)run.seconds=Math.min(TOTAL_SECONDS,run.seconds+seconds);
}
export function calculateScore(run){
 if(!run.started)return null;
 const accuracy=run.total>0?run.correct/run.total:0;
 const factors={duration:Math.max(0,Math.min(1,run.seconds/TOTAL_SECONDS))};
 const score=run.failed?0:100*accuracy*factors.duration;
 return {...run,accuracy,factors,score,stars:starsFor(score)};
}
export function cleanResults(value,stageIds){
 const results=Object.create(null);
 for(const id of stageIds){
  const stars=value?.[id];
  if(Number.isFinite(stars)&&stars>=0&&stars<=3&&Number.isInteger(stars*2))results[id]={best:{stars}};
 }
 return results;
}
