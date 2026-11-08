import test from 'node:test';
import assert from 'node:assert/strict';
import {earlySeconds,labelGeometry,motionStep,metronomeBeats,stopProgress} from '../dist/performance.js';

test('all supported tempos open exactly one thirty-second note early',()=>{
 for(let bpm=90;bpm<=180;bpm++)assert.ok(Math.abs(earlySeconds(bpm)*1000-7500/bpm)<1e-10);
});
test('A touches the bottom when B touches the top, then stays at bottom for fading',()=>{
 for(const [height,zone] of [[800,192],[390,105.3],[300,96]]){
  const a=labelGeometry(0,3,height,zone),b=labelGeometry(1,3,height,zone);
  assert.equal(a.y+36,height);assert.equal(b.y+36,height-zone);assert.equal(a.hidden,false);
  const later=labelGeometry(0,3.1,height,zone);
  assert.equal(later.y,a.y);
  assert.equal(labelGeometry(0,3+36/zone+1e-8,height,zone).hidden,false);
 }
});
test('practice gates at bottom after the early close boundary; passed cards unblock motion',()=>{
 const cards=[{},{}];assert.equal(stopProgress(cards,'practice'),3);
 assert.equal(motionStep(2.9,10000,180,3).progress,3-1/32);
 assert.equal(motionStep(3-1/32,10000,180,3).frozen,true);
 cards[0].practicePassed=true;assert.equal(stopProgress(cards,'practice'),4);
 assert.equal(stopProgress(cards,'challenge'),Infinity);
});
test('metronome contact accents play once and never schedule beyond a frozen gate',()=>{
 for(let bpm=90;bpm<=180;bpm++){
  const first=metronomeBeats(1.99,bpm,null,2);
  assert.equal(first.events.length,1);assert.equal(first.events[0].beat,8);assert.equal(first.events[0].accent,true);
  for(let frame=0;frame<100;frame++)assert.equal(metronomeBeats(2,bpm,first.nextBeat,2).events.length,0);
  assert.equal(metronomeBeats(2,bpm,first.nextBeat,3).events.length,0);
  const resumed=metronomeBeats(2.25,bpm,first.nextBeat,3);
  assert.equal(resumed.events[0].beat,9);assert.equal(resumed.events[0].accent,false);
  const next=metronomeBeats(2.99,bpm,12,3);assert.equal(next.events[0].beat,12);assert.equal(next.events[0].accent,true);
 }
});
