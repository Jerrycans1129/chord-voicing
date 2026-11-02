import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {Scheduler,reviewWeights} from '../dist/scheduler.js';
import {stages,positions} from '../dist/theory.js';
function seeded(seed){let n=seed;return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};}
const sum=a=>a.reduce((a,b)=>a+b,0),spread=a=>Math.max(...a)-Math.min(...a);
let total=0;
function simulate(stage,seed,count,levelFor,{dynamic=false}={}){
 const levels=Object.create(null),s=new Scheduler(stage,{levels,rng:seeded(seed)}),outcome=seeded(seed+76543);
 s.items.forEach((item,i)=>{const level=levelFor(item,i);if(level)levels[item.id]=level;});
 const balanced=new Map(s.items.map(i=>[i.id,0])),roots=new Map(s.items.map(i=>[i.id,new Map(positions(i.pc,i.q,i.inv).map(n=>[n,0]))]));
 const exposure=new Map(s.items.map(i=>[i.id,0]));
 let opportunities=0,reviews=0,fallBacks=0,cooldownViolations=0,invalid=0;
 const observed=[0,0,0,0],expected=[0,0,0,0],variance=[0,0,0,0];
 for(let n=0;n<count;n++){
  const eligible=s.items.filter(i=>reviewWeights[levels[i.id]||0]&&n-(s.lastSeen.get(i.id)??-Infinity)>=4);
  const weights=[0,0,0,0];for(const item of eligible)weights[levels[item.id]]+=reviewWeights[levels[item.id]];
  const denom=sum(weights);
  const last=new Map(s.lastSeen),c=s.next();
  if(c.reviewSlot)opportunities++;
  if(c.source==='review'){
   reviews++;if(n-(last.get(c.id)??-Infinity)<4)cooldownViolations++;
   observed[levels[c.id]]++;
   for(let l=1;l<=3;l++){const p=weights[l]/denom;expected[l]+=p;variance[l]+=p*(1-p);}
  }else {balanced.set(c.id,balanced.get(c.id)+1);if(c.reviewSlot)fallBacks++;}
  const rs=roots.get(c.id);if(!rs?.has(c.root))invalid++;else rs.set(c.root,rs.get(c.root)+1);
  exposure.set(c.id,exposure.get(c.id)+1);
  if(dynamic){const error=c.name==='C♯'?.5:c.name==='E♭'?.2:.02;s.record(c.id,outcome()<error?'wrong':'correct');}
 }
 total+=count;
 assert.equal(opportunities,count*.3);assert.equal(cooldownViolations,0);assert.equal(invalid,0);
 assert.ok(spread([...balanced.values()])<=1);
 assert.ok([...roots.values()].every(r=>spread([...r.values()])<=1));
 for(let l=1;l<=3;l++)assert.ok(Math.abs(observed[l]-expected[l])<=7*Math.sqrt(variance[l])+5,`conditional weighted sampling tier ${l}`);
 const result={stage:stage.id,seed,count,opportunities,reviews,reviewPercent:100*reviews/count,fallBacks,balancedSpread:spread([...balanced.values()]),maxOctaveSpread:Math.max(...[...roots.values()].map(r=>spread([...r.values()]))),cooldownViolations,invalid,observed,expected:expected.map(n=>+n.toFixed(2)),maxWeightedZ:Math.max(...observed.map((n,i)=>Math.abs(n-expected[i])/Math.sqrt(variance[i]||1)))};
 return {result,exposure,levels};
}
const runs=[];
for(const seed of [42,123456,20261101])for(const stage of stages)for(const mode of ['no-errors','mixed-levels']){
 const {result}=simulate(stage,seed,20000,(_,i)=>mode==='no-errors'?0:i%4);runs.push({...result,mode});
}
// A single weak spelling must gain exposure without creating a review for its alias.
const isolated=simulate(stages[4],7351,200000,i=>i.name==='C♯'?3:0);
assert.ok(isolated.exposure.get('note:C♯')>isolated.exposure.get('note:D♭')*2);
assert.deepEqual({...isolated.levels},{'note:C♯':3});
// Large pools approximate 7:3:1 globally; exact expectation remains conditional on cooldown.
const tiers=simulate(stages.at(-1),7352,300000,(_,i)=>1+i%3);
const normalized=tiers.result.observed.slice(1).map(n=>n/tiers.result.reviews);
for(const [i,p] of [1/11,3/11,7/11].entries())assert.ok(Math.abs(normalized[i]-p)<.015);
const dynamic=simulate(stages[4],7353,200000,()=>0,{dynamic:true});
assert.ok(dynamic.exposure.get('note:C♯')>dynamic.exposure.get('note:E♭'));
assert.ok(dynamic.exposure.get('note:E♭')>dynamic.exposure.get('note:D♭'));
const report={totalGenerated:total,assertions:'passed',description:'Deterministic Monte Carlo: 3 seeds × 47 stages × 2 profiles × 20,000 cards, plus isolated/dynamic/large-pool scenarios. Statistical properties only; not a learning-outcome trial.',isolated:{...isolated.result,sharp:isolated.exposure.get('note:C♯'),flat:isolated.exposure.get('note:D♭')},largePool:{...tiers.result,reviewTierShares:normalized},dynamic:{...dynamic.result,exposure:Object.fromEntries(dynamic.exposure)},runs};
writeFileSync(new URL('../reports/scheduler-simulation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({totalGenerated:total,assertions:report.assertions,maxBalancedSpread:Math.max(...runs.map(r=>r.balancedSpread)),maxOctaveSpread:Math.max(...runs.map(r=>r.maxOctaveSpread)),cooldownViolations:sum(runs.map(r=>r.cooldownViolations)),isolated:report.isolated,largePool:report.largePool,dynamic:report.dynamic},null,2));
