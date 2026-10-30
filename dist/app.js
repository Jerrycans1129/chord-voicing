import {stages,makeRound} from './theory.js';
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
let stageIndex=Number(read('voicing-stage',0));if(!Number.isInteger(stageIndex)||!stages[stageIndex])stageIndex=0;
let cycles=read('voicing-cycles',{});if(!cycles||typeof cycles!=='object'||Array.isArray(cycles))cycles={};
let bpm=Number(read('voicing-bpm',60));if(!Number.isFinite(bpm))bpm=60;
bpm=Math.max(40,Math.min(120,Math.round(bpm/10)*10));
let cards=[],elements=[],elapsed=0,previous=0,running=false,started=false,finished=false;
let sessionSeconds=0,baseCycle=0,completedBatches=0;
const MAX_SECONDS=30*60;
let screenLock=null,screenLockGeneration=0;
function releaseScreenLock(){
 screenLockGeneration++;
 const lock=screenLock;screenLock=null;
 if(lock)void lock.release().catch(()=>{});
}
async function keepScreenAwake(){
 const wakeLock=globalThis.navigator?.wakeLock;
 if(!running||document.hidden||!wakeLock)return;
 const generation=++screenLockGeneration;
 try{
  const lock=await wakeLock.request('screen');
  // A request may finish after pause, restart, or leaving the page.
  if(generation!==screenLockGeneration||!running||document.hidden){await lock.release();return;}
  screenLock=lock;
  lock.addEventListener('release',()=>{if(screenLock===lock)screenLock=null;});
 }catch{/* Unsupported or denied wake locks must not interrupt practice. */}
}
let metronomeOn=read('voicing-metronome',true)!==false;
let audioContext=null,nextAudioBeat=null;
const clicks=new Set();
function updateMetronome(){
 $('metronome').textContent=metronomeOn?'节拍器：开':'节拍器：关';
 $('metronome').setAttribute('aria-pressed',String(metronomeOn));
}
function stopMetronome(){
 for(const oscillator of clicks){oscillator.stop();oscillator.disconnect();}
 clicks.clear();nextAudioBeat=null;
}
function unlockAudio(){
 if(!metronomeOn)return;
 try{
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Audio)throw new Error('Audio unavailable');
  audioContext??=new Audio();
  audioContext.resume().catch(()=>{
   metronomeOn=false;stopMetronome();updateMetronome();
  });
 }catch{metronomeOn=false;updateMetronome();}
}
function scheduleMetronome(){
 if(!running||!metronomeOn||audioContext?.state!=='running')return;
 const beat=elapsed*4,secondsPerBeat=60/bpm;
 nextAudioBeat??=Math.ceil(beat-1e-7);
 // Skip missed beats instead of playing a burst after a delayed frame.
 if(nextAudioBeat<beat-.1)nextAudioBeat=Math.ceil(beat);
 while((nextAudioBeat-beat)*secondsPerBeat<.12){
  const delay=Math.max(0,(nextAudioBeat-beat)*secondsPerBeat);
  if(sessionSeconds+delay>=MAX_SECONDS)break;
  const time=audioContext.currentTime+delay;
  const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();
  const accent=nextAudioBeat%4===0;
  oscillator.frequency.setValueAtTime(accent?1400:1000,time);
  gain.gain.setValueAtTime(0,time);
  gain.gain.linearRampToValueAtTime(accent?.22:.15,time+.002);
  gain.gain.exponentialRampToValueAtTime(.001,time+.055);
  oscillator.connect(gain);gain.connect(audioContext.destination);
  clicks.add(oscillator);
  oscillator.onended=()=>{clicks.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  oscillator.start(time);oscillator.stop(time+.06);nextAudioBeat++;
 }
}
updateMetronome();
function updateTimer(){const seconds=Math.floor(sessionSeconds);const value=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;$('timer').textContent=value;$('count').textContent=value;}
const whitePC=[0,2,4,5,7,9,11],centers=new Map(),keyBounds=new Map();let whiteCount=0;
for(let midi=48;midi<=84;midi++){
 const white=whitePC.includes(midi%12),x=white?(whiteCount+.5)/22:whiteCount/22;
 centers.set(midi,x);
 const width=(white?1:.58)/22,left=x-width/2;
 keyBounds.set(midi,{left,right:left+width});
 const key=document.createElement('div');key.className=`key ${white?'white':'black'}`;key.style.left=`${left*100}%`;key.style.width=`${width*100}%`;
 $('keyboard').append(key);
 if(white){const lane=document.createElement('div');lane.className=`lane ${midi%12===0?'octave':''}`;lane.style.left=`${whiteCount/22*100}%`;$('lanes').append(lane);whiteCount++;}
}
stages.forEach((s,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${String(i+1).padStart(2,'0')}  ${s.name}`;$('stage').append(option);});
$('stage').value=stageIndex;$('speed').value=bpm;$('speed-value').textContent=`${bpm} BPM`;
function showOverlay(title,description,button){$('overlay').hidden=false;$('overlay').querySelector('h1').textContent=title;$('status').textContent=description;$('overlay-action').textContent=button;}
function appendBatch(){
 const batch=makeRound(stages[stageIndex],baseCycle+cards.length/36);
 for(const card of batch){
  const el=document.createElement('div');el.className='card';el.dataset.inv=card.inv;
  const bounds=keyBounds.get(card.root);
  el.style.left=`${centers.get(card.root)*100}%`;el.hidden=true;
  const halo=document.createElement('span');halo.className='halo';
  // Keep the label centered while anchoring the halo to the actual key edge.
  const halfKeyWidth=(bounds.right-bounds.left)*50;
  if(card.inv===0)halo.style.left=`calc(50% - ${halfKeyWidth}cqw)`;
  if(card.inv===1)halo.style.right=`calc(50% - ${halfKeyWidth}cqw)`;
  const chord=document.createElement('span');chord.className='chord';chord.textContent=card.label;
  el.append(halo,chord);$('falling').append(el);elements.push(el);cards.push(card);
 }
}
function reset(){
 releaseScreenLock();stopMetronome();
 running=false;started=false;finished=false;elapsed=0;previous=0;sessionSeconds=0;completedBatches=0;
 baseCycle=Number.isSafeInteger(cycles[stageIndex])?cycles[stageIndex]:0;
 cards=[];elements=[];$('falling').replaceChildren();appendBatch();updateTimer();
 $('stage-number').textContent=`${stageIndex+1} / 14`;
 showOverlay('准备训练','标签平滑下落，触及琴键时弹奏，背景竖线随拍亮起。轻点任意位置暂停，最长 30 分钟。','开始训练 →');
}
function pause(){if(!running)return;advance(performance.now());if(finished)return;running=false;releaseScreenLock();stopMetronome();showOverlay('训练已暂停','进度已保留，准备好后继续。','继续训练 →');$('status').textContent='已暂停 · 切换阶段将重新开始一轮';}
function play(){if(running){pause();return;}if(finished)reset();running=true;started=true;previous=performance.now();unlockAudio();void keepScreenAwake();$('overlay').hidden=true;$('status').textContent='训练中 · 标记到达琴键上沿时弹奏';}
function complete(){releaseScreenLock();stopMetronome();running=false;finished=true;elements.forEach(el=>{el.hidden=true;});showOverlay('本轮已完成','本次训练已持续 30:00。可以重新开始，或选择其他训练阶段。','再练一轮 →');}
function advance(now){
 if(running){const dt=Math.min(Math.max(0,(now-previous)/1000),MAX_SECONDS-sessionSeconds);sessionSeconds+=dt;elapsed+=dt*bpm/240;updateTimer();
  const batches=Math.floor(Math.max(0,Math.floor(elapsed-2)+1)/36);
  if(batches>completedBatches){completedBatches=batches;cycles[stageIndex]=baseCycle+batches;save('voicing-cycles',cycles);}
  if(sessionSeconds>=MAX_SECONDS)complete();
 }
 previous=now;
}
function render(now){
 advance(now);
 scheduleMetronome();
 if(started&&!finished){
  while(elapsed+2>=cards.length)appendBatch();
  const height=$('falling').clientHeight;
  const beats=elapsed*4,beatIndex=Math.floor(beats),phase=beats-beatIndex;
  const pulse=Math.pow(Math.max(0,1-phase/.7),2);
  $('lanes').style.setProperty('--beat-glow',String(pulse));
  const landedIndex=Math.floor(elapsed-2);
  cards.forEach((_,i)=>{
   const progress=(elapsed-i)/2;const el=elements[i];
   el.hidden=progress<0||i<landedIndex;
   el.dataset.landed=String(progress>=1);
   // Descend continuously until the 36px label meets the key edge.
   if(!el.hidden){
    // Start fully above the clipped track so labels enter through its top edge.
    const top=-44,bottom=height-36;
    el.style.transform=`translateY(${top+Math.min(progress,1)*(bottom-top)}px)`;
   }
  });
 }
 requestAnimationFrame(render);
}
$('metronome').addEventListener('pointerup',e=>e.stopPropagation());
$('metronome').addEventListener('click',e=>{
 e.stopPropagation();metronomeOn=!metronomeOn;save('voicing-metronome',metronomeOn);
 stopMetronome();if(metronomeOn)unlockAudio();updateMetronome();
});
$('overlay-action').addEventListener('click',e=>{e.stopPropagation();play();});$('restart').addEventListener('click',e=>{e.stopPropagation();reset();play();});
document.addEventListener('click',()=>{if(running)pause();});
// Direct touch handling also supports non-interactive surfaces in mobile Safari.
document.addEventListener('pointerup',e=>{if(e.pointerType==='touch'&&running)pause();});
$('stage').addEventListener('change',()=>{stageIndex=Number($('stage').value);save('voicing-stage',stageIndex);reset();});
$('speed').addEventListener('change',()=>{advance(performance.now());stopMetronome();bpm=Number($('speed').value);$('speed-value').textContent=`${bpm} BPM`;save('voicing-bpm',bpm);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
const portrait=matchMedia('(orientation: portrait) and (max-width: 1100px) and (any-pointer: coarse)');portrait.addEventListener('change',e=>{if(e.matches)pause();});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();play();}});
reset();requestAnimationFrame(render);
