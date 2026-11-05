import {stages,names,qualities,curriculum,selectable,currentProgress,migrateResults} from './theory.js';
import {BUILD_REVISION} from './build.js';
import {Scheduler,cleanLevels} from './scheduler.js';
import {VERSION,SPEEDS,TOTAL_SECONDS,normalizeBpm,createRun,recordConditions,calculateScore,cleanResults} from './scoring.js';
import {JUDGMENT_POLICY,activeQuestionIndex,prepareAttempt,stampBoundaries,attackTargets,targetForNote,applyAttack,isCorrect,canSettle} from './judgment.js';
import {TIMING_KEY,MAX_TIMING_EVENTS,createTimingRun,addTimingSegment,recordTimingAttack,analyzeTiming,trimTiming,loadTiming,timingObservation} from './timing.js';
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const levels=cleanLevels(read('voicing-weakness-v1',{}));
const results=cleanResults(migrateResults(read('voicing-results-v1',{})),[...stages.map(s=>s.id),'level-3','level-4','level-5','level-6']);
let stageIndex=currentProgress(results);
let expandedTop=stages[stageIndex].projectId;
let expandedQuality=stages[stageIndex].id.startsWith('quality-')?stages[stageIndex].id:stages[stageIndex].parent?.startsWith('quality-')?stages[stageIndex].parent:null;
let timingRuns=loadTiming(read(TIMING_KEY,null)),timingRun=null,timingDirty=false,timingSavedAt=0,timingStorageFailed=false;
function persistTiming(){
 if(!timingDirty)return;
 timingRuns=trimTiming(timingRuns);
 try{localStorage.setItem(TIMING_KEY,JSON.stringify({schema:1,runs:timingRuns}));timingDirty=false;timingStorageFailed=false;}
 catch{timingStorageFailed=true;}
}
function paintTiming(){
 const stats=analyzeTiming(timingRuns.filter(r=>r.policy===JUDGMENT_POLICY)),percent=n=>n===null?'—':`${n.toFixed(1)}%`;
 $('timing-summary').textContent=stats.recorded
  ?`当前规则（提前 180ms）：已记录 ${stats.recorded} 次按键；可分析 ${stats.total} 次，涉及 ${stats.sampledBoundaries} 个分界。触线前 180ms：${stats.early180} 次（${percent(stats.early180Percent)}）；后 180ms：${stats.late180} 次（${percent(stats.late180Percent)}）；正好触线：${stats.onBoundary} 次。开场排除 ${stats.opening} 次，分界待确定 ${stats.pending} 次。`
  :'尚无弹奏数据。开始训练后自动记录。';
 const candidate=stats.candidates.find(c=>c.ms===180);
 $('timing-detail').textContent=stats.total?`前 180ms 中：仅匹配下一题 ${candidate.nextOnly} 次，仅匹配上一题 ${candidate.previousOnly} 次，共有音 ${candidate.shared} 次，均不匹配 ${candidate.neither} 次。共有音不能确定换题意图。`:'';
 $('timing-storage').textContent=timingStorageFailed?'本地保存失败，数据暂留在当前页面，请及时导出。':`旧规则数据保留在导出中。仅保存在此浏览器，保留最近 ${MAX_TIMING_EVENTS} 次按键。导出包含逐次记录、速度分组和 80／120／180／240ms 对比。`;
 $('timing-export').disabled=!timingRuns.some(r=>r.events.length);
}
$('timing-export').addEventListener('click',()=>{
 persistTiming();
 const payload={schema:1,exportedAt:new Date().toISOString(),limit:MAX_TIMING_EVENTS,
  reference:'Nearest actual visual question boundary in active training time; negative is early. Opening and unresolved boundaries excluded from percentages. Each fresh Note On is one sample, not one chord.',
  summary:analyzeTiming(timingRuns),runs:timingRuns.map(r=>({...r,events:r.events.map(e=>({...e,observation:timingObservation(r,e)}))}))};
 const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));
 const link=document.createElement('a');link.href=url;link.download=`voicing-timing-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 paintTiming();
});
let scheduler,settled=0,run=createRun();
let bpm=normalizeBpm(read('voicing-bpm',90));
let cards=[],elements=[],elapsed=0,previous=0,running=false,started=false,finished=false;
let sessionSeconds=0;
const MAX_SECONDS=TOTAL_SECONDS;
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
// Prefer explicit phone signals; screen size (not window size) avoids treating
// a narrow tablet or desktop window as a phone. The fallback is touch-only.
function isPhoneDevice(){
 const nav=globalThis.navigator||{},ua=nav.userAgent||'';
 if(/iPad/i.test(ua)||(/Macintosh/i.test(ua)&&nav.maxTouchPoints>1))return false;
 if(nav.userAgentData?.mobile||/iPhone|iPod|Android.*Mobile/i.test(ua))return true;
 const screen=globalThis.screen;
 return !!(screen&&Math.min(screen.width,screen.height)>0&&Math.min(screen.width,screen.height)<=500&&matchMedia('(pointer: coarse)').matches);
}
const phoneLayout=isPhoneDevice();
$('instrument').dataset.phone=String(phoneLayout);
let keyboardBlurOn=read('voicing-keyboard-blur',true)!==false;
function updateKeyboardBlur(){
 $('instrument').dataset.running=String(running);
 $('instrument').dataset.hideKeys=String(phoneLayout&&keyboardBlurOn);
 $('keyboard').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);
 $('keyboard-frost').hidden=phoneLayout||!keyboardBlurOn;
 $('keyboard-frost').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);
 $('keyboard-blur-setting').hidden=false;
 $('keyboard-blur').checked=keyboardBlurOn;
}
let metronomeOn=read('voicing-metronome',true)!==false;
let audioContext=null,nextAudioBeat=null;
const clicks=new Set();
function updateMetronome(){
 $('metronome').textContent=metronomeOn?'开':'关';
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
function updateTimer(){
 const seconds=Math.floor(sessionSeconds);
 const time=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
 $('count').textContent=`${time} / 30:00`;
 $('training-time').textContent=time;
 $('answer-count').textContent=`${run.correct} / ${run.total}`;
 $('accuracy').textContent=run.total?`${(100*run.correct/run.total).toFixed(1)}%`:'—';
}

const whitePC=[0,2,4,5,7,9,11],centers=new Map(),keyBounds=new Map(),answerDots=new Map(),midiKeys=new Map();let whiteCount=0;
for(let midi=48;midi<=84;midi++){
 const white=whitePC.includes(midi%12),x=white?(whiteCount+.5)/22:whiteCount/22;
 centers.set(midi,x);
 const width=(white?1:.58)/22,left=x-width/2;
 keyBounds.set(midi,{left,right:left+width});
 const key=document.createElement('div');key.className=`key ${white?'white':'black'}`;key.style.left=`${left*100}%`;key.style.width=`${width*100}%`;
 const dot=document.createElement('span');dot.className='answer-dot';dot.hidden=true;dot.setAttribute('aria-hidden','true');key.append(dot);answerDots.set(midi,dot);
 key.dataset.midi=String(midi);midiKeys.set(midi,key);
 $('keyboard').append(key);
 if(white){const lane=document.createElement('div');lane.className=`lane ${midi%12===0?'octave':''}`;lane.style.left=`${whiteCount/22*100}%`;$('lanes').append(lane);whiteCount++;}
}
// MIDI is input-only: track physical keys separately for each device/channel.
// Sustain does not keep a released physical key highlighted.
let midiAccess=null,midiConnecting=false;
const midiInputs=new Map(),midiHeld=new Map();
function paintMidi(){
 const held=new Set([...midiHeld.values()].flatMap(channels=>[...channels.values()].flatMap(keys=>[...keys])));
 for(const [note,key] of midiKeys)key.dataset.midiPressed=String(held.has(note));
 const outside=[...held].filter(note=>!midiKeys.has(note)).length;
 $('midi-notes').textContent=held.size?`按下 ${held.size} 键${outside?` · ${outside} 键超出 C3–C6`:''}`:'等待演奏';
}
function clearMidi(){midiHeld.clear();paintMidi();}
function receiveMidi(id,event){
 if(document.hidden||!midiInputs.has(id))return;
 const data=event.data;
 if(!data||!data.length)return;
 const [status,note,velocity]=data;
 if(status===0xff){clearMidi();return;}
 if(data.length<3||status<0x80||status>=0xf0||note>127||velocity>127)return;
 const command=status&0xf0,channel=status&0x0f;
 if(![0x80,0x90,0xb0].includes(command))return;
 let channels=midiHeld.get(id);if(!channels){channels=new Map();midiHeld.set(id,channels);}
 let keys=channels.get(channel);if(!keys){keys=new Set();channels.set(channel,keys);}
 if(command===0x90&&velocity>0){const fresh=!keys.has(note);keys.add(note);if(fresh)judgeMidi(note,{timeStamp:event.timeStamp,velocity,channel});}
 else if(command===0x80||command===0x90)keys.delete(note);
 else if(note===120||note===123||(note>=124&&note<=127))keys.clear();
 else return;
 paintMidi();
}
function paintFeedback(index){
 const card=cards[index],el=elements[index];
 el.dataset.feedback=card.feedback||'waiting';
 // Silence and incomplete chords stay opaque; only a complete correct answer fades.
 // Use visual progress, including for answers completed in the early judgment window.
 // Pausing shows the answer at full brightness; resuming restores its visual progress.
 el.style.opacity=!running||card.feedback!=='correct'?'1'
  :String(Math.max(0,Math.min(1,index+3-elapsed)));
}
function judgeMidi(note,meta={}){
 if(!running)return;
 // MIDI can arrive between animation frames; judge against the current clock.
 const handledMs=performance.now();advance(handledMs);
 if(!running)return;
 syncCards();
 if(timingRun){recordTimingAttack(timingRun,cards,note,{...meta,metronome:metronomeOn,judgmentIndex:activeQuestionIndex(cards,sessionSeconds)},handledMs);timingDirty=true;timingRuns=trimTiming(timingRuns);}
 const {indices}=attackTargets(cards,sessionSeconds);
 for(const index of indices){
  const card=cards[index];applyAttack(card,note);
  if(card.wrong&&!card.errorRecorded){card.errorRecorded=true;if(scheduler.record(card.id,'wrong'))save('voicing-weakness-v1',levels);}
  paintFeedback(index);
 }
}

function syncMidiInputs(){
 const connected=new Map([...midiAccess.inputs.values()].filter(input=>input.state==='connected').map(input=>[input.id,input]));
 for(const [id,input] of midiInputs){
  if(connected.get(id)!==input){if(running)advance(performance.now());input.onmidimessage=null;midiInputs.delete(id);midiHeld.delete(id);const active=cards[activeQuestionIndex(cards,sessionSeconds)];if(active)active.assisted=true;}
 }
 for(const [id,input] of connected){
  if(midiInputs.has(id))continue;
  midiInputs.set(id,input);input.onmidimessage=event=>receiveMidi(id,event);
 }
 if(started&&!finished&&running&&!midiInputs.size)pause();
 $('midi-status').textContent=midiInputs.size?`已连接：${[...midiInputs.values()].map(input=>input.name||'MIDI 输入设备').join('、')}`:'已启用 · 未发现 MIDI 输入，请连接键盘';
 paintMidi();
}
function midiAvailability(){
 if(globalThis.isSecureContext===false)return 'MIDI 需要 HTTPS 或本机 localhost，局域网 HTTP 不支持';
 if(typeof globalThis.navigator?.requestMIDIAccess!=='function')return '当前浏览器未提供 Web MIDI，请使用支持 MIDI 的浏览器或扩展';
 return '';
}
async function connectMidi(){
 if(midiConnecting)return;
 const unavailable=midiAvailability();
 if(unavailable){$('midi-status').textContent=unavailable;return;}
 midiConnecting=true;$('midi-connect').disabled=true;$('midi-status').textContent='正在请求 MIDI 访问…';
 try{
  midiAccess=await navigator.requestMIDIAccess({sysex:false});
  midiAccess.onstatechange=syncMidiInputs;syncMidiInputs();
  $('midi-connect').textContent='刷新 MIDI 设备';
 }catch(error){
  $('midi-status').textContent=error.name==='NotAllowedError'||error.name==='SecurityError'?'MIDI 访问未获允许，请检查网站权限后重试':'无法连接 MIDI，请检查设备后重试';
 }finally{midiConnecting=false;$('midi-connect').disabled=false;}
}
$('midi-connect').addEventListener('click',event=>{event.stopPropagation();void connectMidi();});
$('midi-warning').addEventListener('click',event=>event.stopPropagation());
$('midi-warning-close').addEventListener('click',event=>{event.stopPropagation();$('midi-warning').close();});
$('midi-warning-connect').addEventListener('click',event=>{event.stopPropagation();$('midi-warning').close();openSettings();void connectMidi();});
$('midi-clear').addEventListener('click',event=>{event.stopPropagation();clearMidi();});
void connectMidi();
paintMidi();
const routeNodes=[],stageButtons=new Map();
function setStars(element,value){
 element.replaceChildren();element.setAttribute('role','img');element.setAttribute('aria-label',value===undefined?'':`${value} 星`);
 if(value===undefined)return;
 const base=document.createElement('span');base.className='stars-base';base.textContent='★★★';base.setAttribute('aria-hidden','true');
 const fill=document.createElement('span');fill.className='stars-fill';fill.textContent='★★★';fill.setAttribute('aria-hidden','true');fill.style.width=`${value/3*100}%`;
 element.append(base,fill);
}
const nodeById=new Map([...stages,...curriculum].map(n=>[n.id,n]));
const routeRows=[$('route-top'),$('route-second'),$('route-third')];
for(const stage of nodeById.values()){
 const node=document.createElement('button');node.type='button';node.className='route-node';node.dataset.id=stage.id;node.dataset.comprehensive=String(!!stage.comprehensive);
 const label=document.createElement('span');label.className='route-name';label.textContent=stage.name;
 const dot=document.createElement('span');dot.className='route-dot';dot.append(label);
 const stars=document.createElement('span');stars.className='stars';node.append(dot,stars);
 node.addEventListener('click',()=>selectNode(stage.id));
 if(!stage.project)routeNodes[stages.indexOf(stage)]=node;
 stageButtons.set(stage.id,node);
}
function updateRoute(){
 const quality=nodeById.get(expandedQuality);
 const rows=[curriculum,curriculum.flatMap(n=>n.children),quality?.children??[]];
 rows.forEach((nodes,i)=>{
  const buttons=nodes.map(n=>stageButtons.get(n.id)),existing=Array.from(routeRows[i].children);
  if(existing.length!==buttons.length||buttons.some((button,j)=>button!==existing[j])){
   routeRows[i].replaceChildren(...buttons);
   if(!matchMedia('(prefers-reduced-motion: reduce)').matches)buttons.forEach((button,j)=>button.animate?.([{opacity:0},{opacity:1}],{duration:360,delay:Math.min(j*22,132),easing:'cubic-bezier(.2,.7,.2,1)',fill:'backwards'}));
  }
  routeRows[i].hidden=!nodes.length;
 });
 for(const [id,node] of stageButtons){
  const stage=nodeById.get(id),selected=stages[stageIndex]?.id===id;
  node.setAttribute('aria-current',stage.project?(id===expandedTop?'location':'false'):(selected?'step':'false'));
  node.dataset.expanded=String(stage.children? id===expandedTop||id===expandedQuality:false);
  if(stage.children&&!stage.project)node.setAttribute('aria-expanded',node.dataset.expanded);
  node.dataset.recommended=String(stages[currentProgress(results)]?.id===id);
  node.setAttribute('aria-label',`${stage.name}${node.dataset.recommended==='true'?' · 推荐练习':''}`);
  setStars(node.querySelector('.stars'),results[id]?.best.stars);
 }
 $('overlay-action').disabled=stageIndex<0||!selectable(stages[stageIndex],results);
 requestAnimationFrame(drawBranches);
}
// Keep the inversion group centered directly beneath its chord while scrolling.
function drawBranches(){
 const path=$('branch-quality'),parent=stageButtons.get(expandedQuality),row=routeRows[2];
 $('branch-top').setAttribute('d','');
 if(!parent||!row.children.length||row.hidden){path.setAttribute('d','');return;}
 const bounds=$('route').getBoundingClientRect(),clip=routeRows[1].getBoundingClientRect();
 const from=parent.querySelector('.route-dot').getBoundingClientRect();
 const center=(from.left+from.right)/2;
 const visible=from.left>=clip.left&&from.right<=clip.right;
 row.style.visibility=visible?'visible':'hidden';
 if(!visible){path.setAttribute('d','');return;}
 const detail=$('route-details').getBoundingClientRect();
 row.style.transform=`translateX(${center-detail.left-row.offsetWidth/2}px)`;
 const to=row.children[0].querySelector('.route-dot').getBoundingClientRect();
 const x=center-bounds.left;
 path.setAttribute('d',`M ${x} ${from.bottom-bounds.top} V ${(to.top+to.bottom)/2-bounds.top}`);
}
for(const row of routeRows)row.addEventListener('scroll',()=>requestAnimationFrame(drawBranches),{passive:true});
globalThis.addEventListener?.('resize',()=>requestAnimationFrame(drawBranches));
if(typeof ResizeObserver!=='undefined')new ResizeObserver(()=>requestAnimationFrame(drawBranches)).observe($('route'));
let programmaticScrollLeft=null;
function revealProject(){stageButtons.get(expandedTop)?.scrollIntoView?.({block:'nearest',inline:'nearest'});}
function focusCurrentStage(){revealProject();stageButtons.get(expandedQuality)?.scrollIntoView?.({block:'nearest',inline:'center'});routeNodes[stageIndex]?.scrollIntoView?.({block:'nearest',inline:'center'});programmaticScrollLeft=routeRows[1].scrollLeft;}
function syncProjectFromScroll(){
 const row=routeRows[1];
 if(programmaticScrollLeft!==null&&Math.abs(row.scrollLeft-programmaticScrollLeft)<1)return;
 programmaticScrollLeft=null;
 const bounds=row.getBoundingClientRect();
 if(!bounds.width)return;
 const children=Array.from(row.children);
 let closest;
 if(row.scrollLeft<=1)closest=children[0];
 else if(row.scrollLeft+row.clientWidth>=row.scrollWidth-1)closest=children.at(-1);
 else closest=children.reduce((best,node)=>{
  const rect=node.getBoundingClientRect(),distance=Math.abs((rect.left+rect.right-bounds.left-bounds.right)/2);
  return !best||distance<best.distance?{node,distance}:best;
 },null)?.node;
 const project=nodeById.get(closest?.dataset.id)?.projectId;
 if(project&&project!==expandedTop){expandedTop=project;updateRoute();revealProject();}
}
routeRows[1].addEventListener('scroll',()=>requestAnimationFrame(syncProjectFromScroll),{passive:true});
function selectNode(id){
 if(started&&!finished)return;
 const stage=nodeById.get(id);if(!stage)return;
 if(stage.project){
  expandedTop=id;updateRoute();revealProject();
  stageButtons.get(stage.children[0].id)?.scrollIntoView?.({block:'nearest',inline:'center'});
  programmaticScrollLeft=routeRows[1].scrollLeft;
  return;
 }
 expandedTop=stage.projectId;
 expandedQuality=stage.children?stage.id:stage.parent?.startsWith('quality-')?stage.parent:null;
 stageIndex=selectable(stage,results)?stages.indexOf(stage):-1;
 reset();focusCurrentStage();
 if(stageIndex<0)stageButtons.get(id)?.scrollIntoView?.({block:'nearest',inline:'center'});
 programmaticScrollLeft=routeRows[1].scrollLeft;
}
function selectStage(index){if(stages[index])selectNode(stages[index].id);}
$('version').textContent=`v${VERSION}+${BUILD_REVISION}`;
for(const speed of SPEEDS){const option=document.createElement('option');option.value=speed.bpm;option.textContent=`${speed.name} · ${speed.bpm} BPM`;$('speed').append(option);}
$('speed').value=bpm;
// Native touch scrolling; mouse dragging captures only after a real drag.
let routeDrag=null,suppressRouteClick=false;
for(const route of routeRows.slice(0,2)){
route.addEventListener('pointerdown',e=>{
 suppressRouteClick=false;
 if(e.pointerType!=='mouse'||e.button!==0)return;
 routeDrag={id:e.pointerId,x:route===routeRows[0]?e.clientY:e.clientX,left:route===routeRows[0]?route.scrollTop:route.scrollLeft,moved:false};
});
route.addEventListener('pointermove',e=>{
 if(!routeDrag||routeDrag.id!==e.pointerId)return;
 const dx=(route===routeRows[0]?e.clientY:e.clientX)-routeDrag.x;
 if(!routeDrag.moved&&Math.abs(dx)>6){routeDrag.moved=true;route.setPointerCapture(e.pointerId);route.dataset.dragging='true';}
 if(routeDrag.moved){e.preventDefault();if(route===routeRows[0])route.scrollTop=routeDrag.left-dx;else route.scrollLeft=routeDrag.left-dx;}
});
function endRouteDrag(e){
 if(!routeDrag||routeDrag.id!==e.pointerId)return;
 suppressRouteClick=routeDrag.moved;routeDrag=null;route.dataset.dragging='false';
 if(route.hasPointerCapture(e.pointerId))route.releasePointerCapture(e.pointerId);
}
route.addEventListener('pointerup',endRouteDrag);route.addEventListener('pointercancel',endRouteDrag);
route.addEventListener('click',e=>{if(suppressRouteClick&&e.detail!==0){e.preventDefault();e.stopPropagation();suppressRouteClick=false;}},true);
}
document.addEventListener('dragstart',e=>e.preventDefault());
function hidePauseControls(){
 $('settings-toggle').hidden=true;
 for(const dot of answerDots.values())dot.hidden=true;
}
function visualQuestionIndex(){return Math.max(0,Math.floor(elapsed-2));}
function showAnswer(){
 // Pause answers follow the landed label; before the first touch, preview question one.
 const card=cards[visualQuestionIndex()];
 if(card)card.assisted=true;
 for(const [midi,dot] of answerDots)dot.hidden=!card||targetForNote(card,midi)===undefined;
}
function openSettings(){
 if(running||$('settings-dialog').open)return;
 updateTimer();$('session-stats').hidden=!started||finished;$('exit-training').hidden=!started||finished;
 persistTiming();paintTiming();
 $('settings-dialog').showModal();
}
function showHome(){
 updateKeyboardBlur();hidePauseControls();$('overlay').hidden=false;$('settings-toggle').hidden=false;updateRoute();
}
// A card at index i touches the line at musical progress i + 2.
function canReachLine(index){
 return sessionSeconds+(index+2-elapsed)*240/bpm<MAX_SECONDS-1e-9;
}
function syncCards(){
 // Tempo changes can invalidate only the unlanded tail. Keep settled attempts.
 while(cards.length>settled&&cards.length-1+2>elapsed&&!canReachLine(cards.length-1)){
  cards.pop();elements.pop();
  $('falling').replaceChildren(...elements);
 }
 while(elapsed>=cards.length&&canReachLine(cards.length))appendCard();
}
function updateTrainingHeader(){
 $('training-header').hidden=!started||finished;
 const stage=stages[stageIndex];
 const parent=nodeById.get(stage?.parent);
 $('training-name').textContent=stage?(parent&&!parent.project?`${parent.name}-${stage.name}`:stage.name.replace(/\n/g,'')):'';
}
function showResult(result){
 setStars($('result-stars'),result.stars);
 $('result-accuracy').textContent=result.total?`${(result.accuracy*100).toFixed(1)}%`:'—';
 $('result-count').textContent=`${result.correct} / ${result.total}`;
 const seconds=Math.floor(result.seconds);
 $('result-duration').textContent=`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
 const f=result.factors;
 $('result-factors').textContent=`计分系数：暂停 ×${f.pause} · 琴键提示 ×${f.keyboard} · 速度 ×${f.speed} · 时长 ×${f.duration.toFixed(3)}`;
 $('result-dialog').showModal();
}
function appendCard(){
 const card=prepareAttempt(scheduler.next());
  const el=document.createElement('div');el.className='card';el.dataset.inv=card.inv;el.dataset.freeOctaves=String(!!card.freeOctaves);el.dataset.size=card.kind==='note'?1:qualities[card.q].intervals.length;
  el.style.left=`${centers.get(card.root)*100}%`;el.hidden=true;
  if(card.kind!=='note'){
   const bounds=keyBounds.get(card.root);
   const halo=document.createElement('span');halo.className='halo';
   // Keep the label centered while anchoring the halo to the actual key edge.
   const halfKeyWidth=(bounds.right-bounds.left)*50;
   if(!card.freeOctaves&&card.inv===0)halo.style.left=`calc(50% - ${halfKeyWidth}cqw)`;
   if(!card.freeOctaves&&card.inv===1)halo.style.right=`calc(50% - ${halfKeyWidth}cqw)`;
   el.append(halo);
  }
  const chord=document.createElement('span');chord.className='chord';chord.textContent=card.label;
  el.append(chord);
  if(card.freeOctaves){
   el.setAttribute('aria-label',`${card.label}，根音在最左八度，其余四音可跨八度，五音齐全`);
  }
  $('falling').append(el);elements.push(el);cards.push(card);
}
function reset(){
 persistTiming();timingRun=null;
 releaseScreenLock();stopMetronome();
 running=false;started=false;finished=false;elapsed=0;previous=0;sessionSeconds=0;settled=0;run=createRun();
 scheduler=stageIndex>=0?new Scheduler(stages[stageIndex],{levels}):null;
 updateTrainingHeader();$('result-dialog').close();$('lanes').style.setProperty('--beat-glow','0');
 cards=[];elements=[];$('falling').replaceChildren();if(scheduler)appendCard();updateTimer();showHome();
}
function pause(){
 if(!running)return;advance(performance.now());if(finished)return;
 persistTiming();
 running=false;recordConditions(run,{paused:true,visible:true});updateKeyboardBlur();releaseScreenLock();stopMetronome();
 $('overlay').hidden=true;$('settings-toggle').hidden=false;showAnswer();paintScene();
}
function canStartTraining(){
 if(!selectable(stages[stageIndex],results)||$('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return false;
 if([...midiInputs.values()].some(input=>input.state==='connected'))return true;
 $('midi-warning').showModal();return false;
}
function play(){
 if(running){pause();return;}
 if(!canStartTraining())return;
 if(finished)reset();
 if(!timingRun){timingRun=createTimingRun(stages[stageIndex].id,VERSION);timingRuns.push(timingRun);timingRuns=trimTiming(timingRuns);}
 run.started=true;started=true;running=true;
 syncCards();
 stampBoundaries(cards,elapsed,elapsed,sessionSeconds,bpm);settleAnswers();updateTimer();
 recordConditions(run,{visible:!keyboardBlurOn});
 hidePauseControls();updateKeyboardBlur();previous=performance.now();unlockAudio();void keepScreenAwake();$('overlay').hidden=true;paintScene();
}
function complete(){
 if(!started||finished)return;
 persistTiming();
 running=false;finished=true;releaseScreenLock();stopMetronome();
 const result=calculateScore(run),id=stages[stageIndex].id;
 results[id]={last:result,best:!results[id]||result.score>results[id].best.score?result:results[id].best};
 save('voicing-results-v1',results);
 if($('settings-dialog').open)$('settings-dialog').close();
 elements.forEach(el=>{el.hidden=true;});updateTrainingHeader();$('lanes').style.setProperty('--beat-glow','0');showHome();focusCurrentStage();showResult(result);
}
function settleAnswers(){
 while(settled<cards.length&&canSettle(cards[settled],sessionSeconds)){
  const card=cards[settled++];card.ended=true;run.total++;
  if(isCorrect(card)){
   run.correct++;
   if(!card.assisted&&scheduler.record(card.id,'correct'))save('voicing-weakness-v1',levels);
  }
 }
}
function advance(now){
 if(running){
  const fromSeconds=sessionSeconds,fromProgress=elapsed;
  const dt=Math.min(Math.max(0,(now-previous)/1000),MAX_SECONDS-sessionSeconds);
  if(timingRun){addTimingSegment(timingRun,previous,previous+dt*1000,fromSeconds,fromProgress,bpm);timingDirty=true;}
  sessionSeconds+=dt;elapsed+=dt*bpm/240;
  if(MAX_SECONDS-sessionSeconds<1e-9)sessionSeconds=MAX_SECONDS;
  recordConditions(run,{seconds:dt,bpm,visible:!keyboardBlurOn});
  syncCards();
  stampBoundaries(cards,fromProgress,elapsed,fromSeconds,bpm);settleAnswers();updateTimer();
  if(sessionSeconds>=MAX_SECONDS)complete();
 }
 previous=now;
}
function paintScene(){
 updateTrainingHeader();
 if(started&&!finished){
  syncCards();
  const height=$('falling').clientHeight;
  const beats=elapsed*4,beatIndex=Math.floor(beats),phase=beats-beatIndex;
  const pulse=Math.pow(Math.max(0,1-phase/.7),2);
  $('lanes').style.setProperty('--beat-glow',String(pulse));
  const landedIndex=Math.floor(elapsed-2),pausedIndex=visualQuestionIndex();
  cards.forEach((_,i)=>{
   const progress=(elapsed-i)/2;const el=elements[i];
   el.hidden=running?(progress<0||i<landedIndex):i!==pausedIndex;
   el.dataset.landed=String(progress>=1);
   if(!el.hidden)paintFeedback(i);
   // Descend continuously until the 36px label meets the key edge.
   if(!el.hidden){
    // Start fully above the clipped track so labels enter through its top edge.
    const top=-44,bottom=height-36;
    el.style.transform=`translateY(${top+Math.min(progress,1)*(bottom-top)}px)`;
   }
  });
 }
}
function render(now){
 advance(now);
 if(now-timingSavedAt>=5000){persistTiming();timingSavedAt=now;}
 scheduleMetronome();
 paintScene();
 requestAnimationFrame(render);
}
$('keyboard-blur').addEventListener('change',()=>{
 keyboardBlurOn=$('keyboard-blur').checked;save('voicing-keyboard-blur',keyboardBlurOn);updateKeyboardBlur();
 if(started&&!finished&&!keyboardBlurOn)recordConditions(run,{visible:true});
});
$('metronome').addEventListener('click',e=>{
 e.stopPropagation();metronomeOn=!metronomeOn;save('voicing-metronome',metronomeOn);
 stopMetronome();if(metronomeOn)unlockAudio();updateMetronome();
});
$('overlay-action').addEventListener('click',e=>{e.stopPropagation();play();});
$('settings-toggle').addEventListener('click',e=>{e.stopPropagation();openSettings();});
$('settings-dialog').addEventListener('click',e=>e.stopPropagation());
$('settings-close').addEventListener('click',e=>{e.stopPropagation();$('settings-dialog').close();});
$('exit-training').addEventListener('click',e=>{e.stopPropagation();complete();});
$('result-dialog').addEventListener('click',e=>e.stopPropagation());
$('result-home').addEventListener('click',e=>{e.stopPropagation();$('result-dialog').close();});
$('result-retry').addEventListener('click',e=>{e.stopPropagation();$('result-dialog').close();play();});
$('overlay').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{
 if($('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return;
 if(running)pause();else if(started&&!finished&&$('overlay').hidden)play();
});
$('speed').addEventListener('change',()=>{
 advance(performance.now());stopMetronome();bpm=normalizeBpm($('speed').value);$('speed').value=bpm;save('voicing-bpm',bpm);
 if(running){stampBoundaries(cards,elapsed,elapsed,sessionSeconds,bpm);settleAnswers();updateTimer();}
});
globalThis.addEventListener?.('pagehide',persistTiming);
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();clearMidi();}});
const portrait=matchMedia('(orientation: portrait) and (max-width: 1100px) and (any-pointer: coarse)');portrait.addEventListener('change',e=>{if(e.matches)pause();});
document.addEventListener('keydown',e=>{
 if($('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return;
 if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement?.tagName)){e.preventDefault();play();}
});
reset();focusCurrentStage();requestAnimationFrame(render);
