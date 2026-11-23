import test from 'node:test';
import assert from 'node:assert/strict';
import {ChordRecognizer} from '../dist/learning.js';
import {qualities} from '../dist/theory.js';
test('all roots and inversions recognize open voicings',()=>{
 for(let q=0;q<qualities.length;q++)for(let pc=0;pc<12;pc++)for(let inv=0;inv<qualities[q].intervals.length;inv++){
  const r=new ChordRecognizer(q),tones=qualities[q].intervals;
  const bass=36+pc+tones[inv];let match;
  const sequence=[bass,...tones.filter((_,i)=>i!==inv).map(n=>72+pc+n)];
  for(const n of sequence)match=r.attack(n,[],pc);
  assert.deepEqual(match,{pc,inv},`${q}/${pc}/${inv}`);
 }
});
test('candidates recover independently, without a timeout, and ignore octave repetitions',()=>{
 const r=new ChordRecognizer(0);
 for(const n of [60,72,64,65,77,69])assert.equal(r.attack(n),null);
 assert.deepEqual(r.attack(72),{pc:5,inv:0});
 assert.ok(r.candidates.every(c=>c.hits.size===0&&c.bass===Infinity));
});
test('held foreign notes prevent success until a new correct attack; sustain is not input',()=>{
 const r=new ChordRecognizer(0);r.attack(60);r.attack(64);
 assert.equal(r.attack(67,[61,67]),null);
 assert.deepEqual(r.attack(60,[60]),{pc:0,inv:0});
 assert.equal(r.attack(64),null);
});
test('first completion is final and next attack starts a fresh attempt',()=>{
 const r=new ChordRecognizer(0);r.attack(52);r.attack(55);
 assert.deepEqual(r.attack(60),{pc:0,inv:1});
 assert.equal(r.attack(48),null);
 r.reset();assert.ok(r.candidates.every(c=>c.hits.size===0));
});
test('ambiguous symmetric chords prefer the selected root',()=>{
 const r=new ChordRecognizer(17);r.attack(60);r.attack(64);
 assert.deepEqual(r.attack(68,[],4),{pc:4,inv:2});
});
