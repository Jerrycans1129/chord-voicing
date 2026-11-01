import test from 'node:test';import assert from 'node:assert/strict';
import {createRun,recordConditions,calculateScore,starsFor,normalizeBpm,cleanResults,VERSION} from '../dist/scoring.js';
const run=(changes={})=>({...createRun(),started:true,seconds:1800,total:100,correct:100,minBpm:90,...changes});
test('no attempt is blank; an initiated empty attempt is a finite zero-star score',()=>{
 assert.equal(calculateScore(createRun()),null);
 const score=calculateScore(run({seconds:0,total:0,correct:0}));assert.equal(score.score,0);assert.equal(score.stars,0);
});
test('half-star thresholds are exact and never round a near miss upward',()=>{
 assert.equal(starsFor(0),0);assert.equal(starsFor(.000001),.5);
 for(const [threshold,stars] of [[20,1],[40,1.5],[60,2],[75,2.5],[90,3]]){
  assert.equal(starsFor(threshold),stars);assert.equal(starsFor(threshold-.00001),stars-.5);
 }
});
test('global conditions latch once; only speeds actually run affect the minimum',()=>{
 const r=createRun();recordConditions(r,{seconds:10,bpm:40,visible:true,paused:true});assert.equal(r.minBpm,null);assert.equal(r.paused,false);
 r.started=true;recordConditions(r,{seconds:10,bpm:120});recordConditions(r,{seconds:0,bpm:40});assert.equal(r.minBpm,120);
 recordConditions(r,{seconds:10,bpm:60,visible:true,paused:true});
 const once=calculateScore(r);for(let i=0;i<100;i++)recordConditions(r,{paused:true,visible:true,seconds:0,bpm:40});assert.deepEqual(calculateScore(r),once);
 recordConditions(r,{seconds:1,bpm:140});assert.equal(r.minBpm,60);
});
test('approved caps and linear duration apply only to final score, not raw accuracy',()=>{
 for(const [changes,score,stars] of [[{},100,3],[{paused:true,shownKeyboard:true},85.5,2.5],[{minBpm:60,shownKeyboard:true},76.5,2.5],[{minBpm:40,shownKeyboard:true},63,2],[{seconds:900},50,1.5],[{seconds:1},100/1800,.5]]){
  const r=calculateScore(run(changes));assert.ok(Math.abs(r.score-score)<1e-10);assert.equal(r.stars,stars);assert.equal(r.accuracy,1);
 }
});
test('saved results are validated and recalculated, old completion markers are not ratings',()=>{
 assert.deepEqual({...cleanResults({one:{last:{stars:3},best:{stars:3}}},['one'])},{});
 const r=run();const saved=cleanResults({one:{last:{...r,score:999},best:r}},['one']);assert.equal(saved.one.last.score,100);
 assert.equal(normalizeBpm(80),90);assert.equal(normalizeBpm(999),140);assert.equal(normalizeBpm(null),90);assert.equal(VERSION,'0.2.0');
});
