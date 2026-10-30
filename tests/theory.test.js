import test from 'node:test';import assert from 'node:assert/strict';
import {stages,makeRound,notes,positions} from '../dist/theory.js';
test('14 stages follow first, second, root ordering',()=>{assert.equal(stages.length,14);for(const start of [0,4,9])assert.deepEqual(stages.slice(start,start+3).map(s=>s.invs[0]),[1,2,0]);});
test('all rounds balance roots, types, and inversions; every voicing fits C3–C6',()=>{
 for(const stage of stages)for(let cycle=0;cycle<stage.qs.length;cycle++){
 const cards=makeRound(stage,cycle);assert.equal(cards.length,36);
 for(let pc=0;pc<12;pc++)assert.equal(cards.filter(c=>c.pc===pc).length,3);
 for(const q of stage.qs)assert.equal(cards.filter(c=>c.q===q).length,36/stage.qs.length);
 for(const inv of stage.invs)assert.equal(cards.filter(c=>c.inv===inv).length,36/stage.invs.length);
 for(const c of cards){assert.equal(c.root%12,c.pc);assert.ok(notes(c.root,c.q,c.inv).every(n=>n>=48&&n<=84));}
 }
});
test('mixed stages cover all combinations over 2 or 3 completed rounds',()=>{
 for(const idx of [8,13]){const stage=stages[idx],seen=new Set();for(let i=0;i<stage.qs.length;i++)for(const c of makeRound(stage,i))seen.add(`${c.pc}:${c.q}:${c.inv}`);assert.equal(seen.size,12*3*stage.qs.length);}
});
test('root anchors represent conventional close-position inversions',()=>{assert.deepEqual(notes(60,0,0),[60,64,67]);assert.deepEqual(notes(60,0,1),[52,55,60]);assert.deepEqual(notes(60,0,2),[55,60,64]);for(let pc=0;pc<12;pc++)for(let q=0;q<3;q++)for(let inv=0;inv<3;inv++)assert.ok(positions(pc,q,inv).length);});
