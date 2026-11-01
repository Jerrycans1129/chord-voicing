import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {SPEEDS,createRun,recordConditions,calculateScore,starsFor} from '../dist/scoring.js';
import {prepareAttempt,stampBoundaries,attackTargets,applyAttack,isCorrect} from '../dist/judgment.js';
function seeded(seed){let state=seed;return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};}
const rng=seeded(20261101),near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const base=(extra={})=>({...createRun(),started:true,seconds:1800,total:10000,correct:10000,minBpm:90,...extra});
let gridCases=0,historyCases=0,simulatedQuestions=0,eventCases=0;
const caps=[];
// 0.01 percentage point resolution, all settings, 7 duration fractions.
for(const speed of SPEEDS)for(const paused of [false,true])for(const shownKeyboard of [false,true]){
 const settings={minBpm:speed.bpm,paused,shownKeyboard};
 const cap=calculateScore(base(settings));caps.push({bpm:speed.bpm,paused,shownKeyboard,maxScore:cap.score,maxStars:cap.stars});
 for(const seconds of [1,60,300,600,900,1620,1800]){
  let previousScore=-1,previousStars=-1;
  for(let correct=0;correct<=10000;correct++){
   const result=calculateScore(base({...settings,seconds,correct}));gridCases++;
   assert.ok(Number.isFinite(result.score)&&result.score>=0&&result.score<=100);
   assert.ok(result.score>=previousScore&&result.stars>=previousStars);
   assert.equal(result.stars===0,correct===0);assert.equal(result.accuracy,correct/10000);
   assert.ok(result.score<=correct/100+1e-10);
   near(result.score,correct/100*(paused?.95:1)*(shownKeyboard?.9:1)*speed.factor*seconds/1800);
   previousScore=result.score;previousStars=result.stars;
  }
 }
}
// Random histories model actual settings in effect, including arbitrary repeated pauses.
for(let i=0;i<10000;i++){
 const r=createRun();r.started=true;let min=Infinity,paused=false,visible=false,seconds=0;
 for(let j=0;j<20;j++){
  const bpm=SPEEDS[Math.floor(rng()*5)].bpm,dt=rng()<.25?0:1+Math.floor(rng()*20),pause=rng()<.15,show=pause||rng()<.2;
  recordConditions(r,{seconds:dt,bpm,paused:pause,visible:show});
  if(dt>0){seconds+=dt;min=Math.min(min,bpm);}paused||=pause;visible||=show;
 }
 assert.equal(r.minBpm,min);assert.equal(r.seconds,seconds);assert.equal(r.paused,paused);assert.equal(r.shownKeyboard,visible);
 r.total=100;r.correct=80;
 const score=calculateScore(r);
 if(paused&&visible){for(let j=0;j<100;j++)recordConditions(r,{paused:true,visible:true});near(score.score,calculateScore(r).score);}
 historyCases++;
}
// 60,000 stochastic sessions, 6 accuracy profiles; outcomes are independent
// Bernoulli trials, not a claim that human errors behave independently.
const sessions=[];
for(const speed of SPEEDS)for(const mode of ['hidden','visible','paused','visible-paused'])for(const duration of [60,300,900,1620,1800])for(const p of [.1,.5,.8,.9,.95,1]){
 const paused=mode.includes('paused'),shownKeyboard=mode!=='hidden';
 // Lead-in takes 2 question periods. Each question settles 180ms before its visual end.
 const count=Math.max(0,Math.floor((duration+.18)*speed.bpm/240-2+1e-9));
 const hist=[0,0,0,0,0,0,0];let scoreSum=0,correctSum=0;
 const n=100;
 for(let rep=0;rep<n;rep++){
  let correct=0;for(let q=0;q<count;q++){correct+=Number(rng()<p);simulatedQuestions++;}
  const result=calculateScore(base({seconds:duration,total:count,correct,minBpm:speed.bpm,paused,shownKeyboard}));
  hist[Math.round(result.stars*2)]++;scoreSum+=result.score;correctSum+=correct;
 }
 const factor=calculateScore(base({seconds:duration,minBpm:speed.bpm,paused,shownKeyboard})).score;
 const expected=factor*p,mean=scoreSum/n,se=count?factor*Math.sqrt(p*(1-p)/(count*n)):0;
 assert.ok(Math.abs(mean-expected)<=7*se+1e-8);
 sessions.push({bpm:speed.bpm,mode,seconds:duration,successProbability:p,sessions:n,questionsPerSession:count,meanAccuracy:correctSum/(n*count),meanScore:mean,expectedScore:expected,starHistogram:hist});
}
// One million individual Note On events around a handoff. Independent reference
// uses wall-time inequalities, while production maps progress and stamped times.
const timing={both:0,previousOnly:0,nextOnly:0,ignoredNonTargets:0};
for(let i=0;i<1000000;i++){
 const bpm=SPEEDS[i%5].bpm,period=240/bpm,T=3*period;
 const delta=(rng()-.5)*1.2,seconds=T+delta,progress=seconds/period;
 const cards=[prepareAttempt({kind:'chord',root:60,q:0,inv:0}),prepareAttempt({kind:'chord',root:57,q:1,inv:0})];
 stampBoundaries(cards,0,progress,0,bpm);
 const {indices}=attackTargets(cards,seconds);
 const previous=delta<-.18;
 assert.deepEqual(indices,previous?[0]:[1]);
 const note=[57,60,64,66,67][Math.floor(rng()*5)];
 for(const index of indices)applyAttack(cards[index],note);
 for(let index=0;index<2;index++){
  const active=previous?index===0:index===1,expectedHit=active&&cards[index].targets.includes(note);
  assert.equal(cards[index].hits.has(note),expectedHit);
  assert.equal(cards[index].wrong,active&&!cards[index].targets.includes(note));
 }
 if(cards.every(c=>c.hits.size))timing.both++;
 else if(cards[0].hits.size)timing.previousOnly++;else if(cards[1].hits.size)timing.nextOnly++;
 if(note===66&&!cards.some(c=>c.wrong))timing.ignoredNonTargets++;
 eventCases++;
}
const examples=[
 ['标准、完整、全对',base()],['暂停一次、完整、全对',base({paused:true,shownKeyboard:true})],
 ['慢速、显示琴键、全对',base({minBpm:60,shownKeyboard:true})],['很慢、显示琴键、全对',base({minBpm:40,shownKeyboard:true})],
 ['标准、全对、15分钟',base({seconds:900})],['标准、全对、27分钟',base({seconds:1620})],['标准、仅显示琴键、全对',base({shownKeyboard:true})]
].map(([name,run])=>({name,...calculateScore(run)}));
assert.equal(examples[5].stars,3);assert.equal(examples[6].stars,3);
const report={version:'0.2.0',judgmentPolicy:'advance-180ms',seed:20261101,gridCases,historyCases,simulatedSessions:sessions.length*100,simulatedQuestions,eventCases,assertions:'passed',examples,caps,timing,sessions,limitations:['Validates mechanical consistency and consequences, not empirical learning efficacy.','Displaying the keyboard alone permits 3 stars only at 100% accuracy in a full standard-speed run.','At 100% accuracy, 27/30 minutes in otherwise unassisted standard conditions reaches 3 stars.','Each attack belongs to exactly one shifted window; shared notes never count twice and non-target notes are errors.','The same latent accuracy can land on either side of a star threshold because finite question samples vary.']};
writeFileSync(new URL('../reports/scoring-simulation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({gridCases,historyCases,simulatedSessions:report.simulatedSessions,simulatedQuestions,eventCases,assertions:report.assertions,examples:examples.map(e=>({name:e.name,score:e.score,stars:e.stars})),nearThreshold:sessions.filter(s=>s.bpm===90&&s.mode==='hidden'&&s.seconds===1800&&[.9,.95].includes(s.successProbability))},null,2));
