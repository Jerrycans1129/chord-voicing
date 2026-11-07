import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRun,calculateScore} from '../dist/scoring.js';
import {prepareAttempt,stampBoundaries,attackTargets} from '../dist/judgment.js';
let gridCases=0,eventCases=0;
for(const seconds of [0,1,60,300,600,900,1620,1800])for(const failed of [false,true]){
 let previous=-1;
 for(let correct=0;correct<=10000;correct++){
  const result=calculateScore({...createRun(),started:true,seconds,total:10000,correct,failed});
  const expected=failed?0:correct/100*seconds/1800;
  assert.ok(Math.abs(result.score-expected)<1e-10);assert.ok(result.score>=previous);previous=result.score;
  if(failed)assert.equal(result.stars,0);gridCases++;
 }
}
for(let i=-10000;i<=10000;i++){
 const seconds=8+i/100000,progress=seconds*90/240;
 const cards=[prepareAttempt({kind:'chord',root:60,q:0,inv:0}),prepareAttempt({kind:'chord',root:57,q:1,inv:0})];
 stampBoundaries(cards,0,progress,0,90,0);
 assert.deepEqual(attackTargets(cards,seconds).indices,i<0?[0]:[1]);eventCases++;
}
const examples=[['全对完成',1800,100,false],['全对15分钟退出',900,100,false],['全对27分钟退出',1620,100,false],['90%正确率完成',1800,90,false],['堆叠触线',1790,99,true]].map(([name,seconds,correct,failed])=>({name,...calculateScore({...createRun(),started:true,seconds,total:100,correct,failed})}));
const report={gridCases,eventCases,assertions:'passed',examples};
writeFileSync(new URL('../reports/scoring-simulation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
