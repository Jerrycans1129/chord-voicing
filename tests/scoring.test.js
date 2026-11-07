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
test('pause and training settings do not reduce fixed challenge scores',()=>{
 for(const changes of [{},{paused:true,shownKeyboard:true},{minBpm:40}])assert.equal(calculateScore(run(changes)).score,100);
 const r=createRun();recordConditions(r,{seconds:100});assert.equal(r.seconds,0);
 r.started=true;recordConditions(r,{seconds:900});recordConditions(r,{paused:true});assert.equal(r.seconds,900);
 assert.equal(calculateScore(run({seconds:900})).stars,1.5);
 assert.equal(calculateScore(run({seconds:1620})).stars,3);
 assert.equal(calculateScore(run({failed:true})).stars,0);
});
test('only finite half-star ratings are restored, with no run parameters',()=>{
 const saved=cleanResults({a:2.5,b:3,c:0,d:4,e:1.2,f:{best:{stars:3}}},['a','b','c','d','e','f']);
 assert.deepEqual({...saved},{a:{best:{stars:2.5}},b:{best:{stars:3}},c:{best:{stars:0}}});
 assert.equal(normalizeBpm(80),90);
});
