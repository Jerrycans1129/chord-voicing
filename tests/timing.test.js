import test from 'node:test';
import assert from 'node:assert/strict';
import {createTimingRun,addTimingSegment,recordTimingAttack,timingObservation,analyzeTiming,trimTiming,loadTiming} from '../dist/timing.js';
const cards=[{targets:[60,64,67]},{targets:[57,60,64]},{targets:[62,65,69]}];
function setup(){const run=createTimingRun('chords','test');addTimingSegment(run,0,16000,0,0,60);return run;}
function hit(run,ms,note=57,handled=ms){recordTimingAttack(run,cards,note,{timeStamp:ms},handled);return run.events.at(-1);}
test('signed visual boundary offsets classify early, exact, late and target membership',()=>{
 const run=setup();
 for(const [ms,note,offset,match] of [[11820,57,-180,'next'],[11820,67,-180,'previous'],[11820,60,-180,'shared'],[12000,61,0,'neither'],[12180,57,180,'next'],[12180,67,180,'previous']]){
  const o=timingObservation(run,hit(run,ms,note));assert.equal(o.offsetMs,offset);assert.equal(o.match,match);assert.equal(o.boundaryIndex,1);
 }
 const a=analyzeTiming([run]);assert.equal(a.total,6);assert.equal(a.early180,3);assert.equal(a.late180,2);assert.equal(a.onBoundary,1);assert.equal(a.sampledBoundaries,1);assert.equal(a.early180Percent,50);
 assert.deepEqual(a.candidates[2],{ms:180,reassigned:3,nextOnly:1,previousOnly:1,shared:1,neither:0});
});
test('event timestamps isolate dispatch delay; callback fallback remains observable',()=>{
 const run=setup(),e=hit(run,11820,57,12200);
 assert.equal(e.queueDelayMs,380);assert.equal(timingObservation(run,e).offsetMs,-180);
 recordTimingAttack(run,cards,67,{},12200);assert.equal(run.events.at(-1).timestampSource,'callback');assert.equal(timingObservation(run,run.events.at(-1)).offsetMs,200);
});
test('all attacks, including outside ±180ms, form the percentage denominator',()=>{
 const run=setup();for(const ms of [11819,11820,12000,12180,12181,10000])hit(run,ms);
 const a=analyzeTiming([run]);assert.equal(a.early180,1);assert.equal(a.late180,1);assert.equal(a.opening,1);assert.equal(a.total,5);assert.equal(a.early180Percent,20);
 assert.equal(Object.values(a.histogram).reduce((s,n)=>s+n,0),5);
});
test('unreached crossings are excluded until actual crossing, including tempo changes',()=>{
 const run=createTimingRun('chords','test');addTimingSegment(run,0,11820,0,0,60);const e=hit(run,11820);
 assert.equal(timingObservation(run,e).status,'pending');
 addTimingSegment(run,11820,13000,11.82,2.955,120);
 assert.equal(timingObservation(run,e).offsetMs,-90);
 assert.equal(analyzeTiming([run]).candidates[0].reassigned,0);
});
test('pause freezes active offsets and events queued inside pause are excluded',()=>{
 const run=createTimingRun('chords','test');addTimingSegment(run,0,11820,0,0,60);hit(run,11820);
 addTimingSegment(run,21820,23000,11.82,2.955,60);
 const count=run.events.length;hit(run,15000,57,22000);assert.equal(run.events.length,count);
 assert.equal(timingObservation(run,run.events[0]).offsetMs,-180);
 hit(run,22180);assert.equal(timingObservation(run,run.events.at(-1)).offsetMs,180);
});
test('opening observations, groups, bounded retention and persistence round trip',()=>{
 const first=setup();hit(first,7900);hit(first,8100);hit(first,11820);
 const second=createTimingRun('notes','test');addTimingSegment(second,0,8000,0,0,120);hit(second,5910);
 const a=analyzeTiming([first,second]);assert.equal(a.opening,2);assert.equal(Object.keys(a.groups).length,2);
 const kept=trimTiming([first,second],2);assert.equal(kept.reduce((n,r)=>n+r.events.length,0),2);
 assert.equal(loadTiming(JSON.parse(JSON.stringify({schema:1,runs:kept}))).length,2);
 assert.deepEqual(loadTiming({schema:1,runs:[{id:'bad',events:[],segments:[{}]}]}),[]);
});
test('new and legacy policies stay separate in analysis and survive loading',()=>{
 const legacy=setup();legacy.policy='overlap-180ms';hit(legacy,11820);
 const current=setup();hit(current,12180);
 assert.equal(current.policy,'advance-180ms');
 const runs=loadTiming(JSON.parse(JSON.stringify({schema:1,runs:[legacy,current]})));
 const summary=analyzeTiming(runs);
 assert.equal(summary.policies['overlap-180ms'].early180,1);
 assert.equal(summary.policies['advance-180ms'].early180,0);
 assert.equal(summary.policies['advance-180ms'].late180,1);
});
