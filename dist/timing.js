import {JUDGMENT_POLICY} from './judgment.js';
// Observation only: these measurements never change answer judgement.
export const TIMING_KEY='voicing-timing-v1';
export const MAX_TIMING_EVENTS=5000;
const round=value=>Math.round(value*1000)/1000;
export function createTimingRun(stage,version){
 return {id:`${Date.now()}-${Math.random().toString(36).slice(2)}`,createdAt:new Date().toISOString(),stage,version,policy:JUDGMENT_POLICY,segments:[],events:[]};
}
export function addTimingSegment(run,wallStart,wallEnd,secondsStart,progressStart,bpm){
 if(wallEnd<=wallStart)return;
 const last=run.segments.at(-1);
 if(last&&Math.abs(last.wallEnd-wallStart)<1e-6&&last.bpm===bpm)last.wallEnd=wallEnd;
 else run.segments.push({wallStart,wallEnd,secondsStart,progressStart,bpm});
}
export function recordTimingAttack(run,cards,note,meta,handledMs){
 const supplied=Number.isFinite(meta.timeStamp)&&meta.timeStamp>=0&&meta.timeStamp<=handledMs;
 const inputMs=supplied?meta.timeStamp:handledMs;
 const segment=run.segments.findLast(s=>inputMs>=s.wallStart&&inputMs<=s.wallEnd);
 // An event queued during a pause is not an active training sample.
 if(!segment)return;
 const dt=(inputMs-segment.wallStart)/1000,progress=segment.progressStart+dt*segment.bpm/240;
 const previousIndex=Math.floor(progress)-2,nextIndex=previousIndex+1;
 run.events.push({note,velocity:meta.velocity??null,channel:meta.channel??null,inputMs,handledMs,
  judgmentIndex:meta.judgmentIndex??null,timestampSource:supplied?'midi-event':'callback',queueDelayMs:round(handledMs-inputMs),
  seconds:segment.secondsStart+dt,progress,bpm:segment.bpm,previousIndex,nextIndex,
  lowerPreviousTargets:cards[previousIndex-1]?.targets||[],previousTargets:cards[previousIndex]?.targets||[],nextTargets:cards[nextIndex]?.targets||[],
  assisted:!!(cards[previousIndex]?.assisted||cards[nextIndex]?.assisted),metronome:!!meta.metronome});
}
function boundarySeconds(run,progress){
 for(const s of run.segments){
  const end=s.progressStart+(s.wallEnd-s.wallStart)/1000*s.bpm/240;
  if(progress>=s.progressStart-1e-9&&progress<=end+1e-9)return s.secondsStart+(progress-s.progressStart)*240/s.bpm;
 }
 return null;
}
export function timingObservation(run,event){
 const lower=Math.floor(event.progress),upper=lower+1;
 const before=boundarySeconds(run,lower),after=boundarySeconds(run,upper);
 // Use actual crossings, or prove the preceding one is nearer than any future crossing.
 // A later tempo change must never retroactively change a reported offset.
 const last=run.segments.at(-1);
 const knownThrough=last?last.secondsStart+(last.wallEnd-last.wallStart)/1000:0;
 const beforeIsCertain=before!==null&&event.seconds-before<=knownThrough-event.seconds;
 if(after===null&&!beforeIsCertain)return {status:'pending'};
 const useBefore=before!==null&&(after===null||event.seconds-before<=after-event.seconds);
 const boundary=useBefore?lower:upper;
 if(boundary<3)return {status:'opening'};
 const boundaryIndex=boundary-2;
 // For the preceding boundary, context is supplied at capture time as well.
 const prev=useBefore?event.lowerPreviousTargets:event.previousTargets;
 const next=useBefore?event.previousTargets:event.nextTargets;
 const previousMatch=(prev||[]).includes(event.note),nextMatch=(next||[]).includes(event.note);
 return {status:'measured',boundaryIndex,offsetMs:round((event.seconds-(useBefore?before:after))*1000),
  match:previousMatch?(nextMatch?'shared':'previous'):(nextMatch?'next':'neither')};
}
function bucket(){return {total:0,early180:0,onBoundary:0,late180:0,nearMatches:{previous:0,next:0,shared:0,neither:0},
 histogram:{'below -240':0,'-240 to -180':0,'-180 to -120':0,'-120 to -60':0,'-60 to 0':0,'0':0,'0 to 60':0,'60 to 120':0,'120 to 180':0,'180 to 240':0,'above 240':0},
 candidates:[80,120,180,240].map(ms=>({ms,reassigned:0,nextOnly:0,previousOnly:0,shared:0,neither:0})),boundaries:new Set()};}
function accumulate(b,event,o,run){
 b.total++;b.boundaries.add(`${run.id}:${o.boundaryIndex}`);
 const d=o.offsetMs;
 if(d>=-180&&d<0)b.early180++;
 if(d===0)b.onBoundary++;
 if(d>0&&d<=180)b.late180++;
 if(Math.abs(d)<=180)b.nearMatches[o.match]++;
 const label=d< -240?'below -240':d< -180?'-240 to -180':d< -120?'-180 to -120':d< -60?'-120 to -60':d<0?'-60 to 0':d===0?'0':d<=60?'0 to 60':d<=120?'60 to 120':d<=180?'120 to 180':d<=240?'180 to 240':'above 240';
 b.histogram[label]++;
 for(const c of b.candidates)if(d>=-c.ms&&d<0){c.reassigned++;c[o.match==='next'?'nextOnly':o.match==='previous'?'previousOnly':o.match]++;}
}
function finish(b){const {boundaries,...counts}=b;return {...counts,sampledBoundaries:boundaries.size,
 early180Percent:b.total?round(b.early180/b.total*100):null,late180Percent:b.total?round(b.late180/b.total*100):null};}
export function analyzeTiming(runs){
 const total=bucket(),groups=new Map(),policies=new Map();let pending=0,opening=0,recorded=0;
 for(const run of runs)for(const event of run.events){
  recorded++;const o=timingObservation(run,event);
  if(o.status==='pending'){pending++;continue;}if(o.status==='opening'){opening++;continue;}
  accumulate(total,event,o,run);
  if(!policies.has(run.policy))policies.set(run.policy,bucket());accumulate(policies.get(run.policy),event,o,run);
  const key=`${run.stage} / ${event.bpm} BPM / ${run.policy}`;
  if(!groups.has(key))groups.set(key,bucket());accumulate(groups.get(key),event,o,run);
 }
 return {recorded,pending,opening,...finish(total),policies:Object.fromEntries([...policies].map(([k,v])=>[k,finish(v)])),groups:Object.fromEntries([...groups].map(([k,v])=>[k,finish(v)]))};
}
export function trimTiming(runs,limit=MAX_TIMING_EVENTS){
 let remove=Math.max(0,runs.reduce((n,r)=>n+r.events.length,0)-limit);
 for(const r of runs){const count=Math.min(remove,r.events.length);r.events.splice(0,count);remove-=count;}
 return runs.filter((r,i)=>r.events.length||i===runs.length-1);
}
export function loadTiming(value){
 if(!value||value.schema!==1||!Array.isArray(value.runs))return [];
 return trimTiming(value.runs.filter(r=>r&&typeof r.id==='string'&&Array.isArray(r.segments)&&Array.isArray(r.events)&&
  r.segments.every(s=>['wallStart','wallEnd','secondsStart','progressStart','bpm'].every(k=>Number.isFinite(s[k]))&&s.bpm>0)&&
  r.events.every(e=>e&&Number.isFinite(e.progress)&&Number.isFinite(e.seconds)&&Number.isFinite(e.bpm)&&Array.isArray(e.previousTargets)&&Array.isArray(e.nextTargets)&&Array.isArray(e.lowerPreviousTargets))));
}
