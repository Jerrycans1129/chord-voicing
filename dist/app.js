import {stages,names,qualities,curriculum,selectable,supportsPractice,currentProgress} from './theory.js';
import {BUILD_REVISION} from './build.js';
import {Scheduler,cleanLevels} from './scheduler.js';
import {VERSION,TOTAL_SECONDS,normalizeBpm,createRun,calculateScore,cleanResults} from './scoring.js';
import {activeQuestionIndex,prepareAttempt,stampBoundaries,attackTargets,targetForNote,applyAttack,applyPracticeInput,updatePracticeState,practiceBlockedIndex,isCorrect,canSettle} from './judgment.js';
import {motionStep,stopProgress,labelGeometry,metronomeBeats,EPSILON} from './performance.js';
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const levels=cleanLevels({});
// Persist ratings only; performance input is never recorded or saved.
try{for(const key of Object.keys(localStorage))if(key.startsWith('voicing-')&&key!=='voicing-stars')localStorage.removeItem(key);}catch{}
const results=cleanResults(read('voicing-stars',{}),[...stages.map(s=>s.id),'level-3','level-4','level-5','level-6']);
let stageIndex=currentProgress(results);
let expandedTop=stages[stageIndex].projectId;
let expandedQuality=stages[stageIndex].id.startsWith('quality-')?stages[stageIndex].id:stages[stageIndex].parent?.startsWith('quality-')?stages[stageIndex].parent:null;
let scheduler,settled=0,run=createRun();
let mode='challenge';
let bpm=90;
const practiceSettings={metronomeOn:false};
let cards=[],elements=[],elapsed=0,previous=0,running=false,started=false,finished=false;
let sessionSeconds=0,strikeFlashAt=-Infinity;
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
let keyboardBlurOn=true;
function updateKeyboardBlur(){
 $('instrument').dataset.running=String(running);
 $('instrument').dataset.midiFeedback=String(mode!=='practice');
 $('instrument').dataset.performance=String(mode!=='free'&&started&&!finished);
 $('instrument').dataset.challenge=String(mode==='challenge'&&started&&!finished);
 $('instrument').dataset.paused=String(mode!=='free'&&started&&!finished&&!running);
 $('instrument').dataset.hideKeys=String(phoneLayout&&keyboardBlurOn);
 $('keyboard').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);
 $('keyboard-frost').hidden=phoneLayout||!keyboardBlurOn;
 $('keyboard-frost').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);

}
let metronomeOn=true;
let audioContext=null,nextAudioBeat=null,lastAudioBeat=-1;
const clicks=new Set();
function updateMetronome(){
 $('metronome').textContent=metronomeOn?'开':'关';
 $('metronome').setAttribute('aria-pressed',String(metronomeOn));
}
function stopMetronome(){
 for(const oscillator of clicks){if(oscillator.scheduledAt<=audioContext.currentTime)lastAudioBeat=Math.max(lastAudioBeat,oscillator.scheduledBeat);oscillator.cancelled=true;oscillator.stop();oscillator.disconnect();}
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
 const schedule=metronomeBeats(elapsed,bpm,nextAudioBeat??Math.max(Math.ceil(elapsed*4-EPSILON),lastAudioBeat+1),stopProgress(cards,mode));
 nextAudioBeat=schedule.nextBeat;
 for(const {beat,delay,accent} of schedule.events){
  if(mode==='challenge'&&sessionSeconds+delay>=MAX_SECONDS)break;
  const time=audioContext.currentTime+delay;
  const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();
  oscillator.frequency.setValueAtTime(accent?1400:1000,time);
  gain.gain.setValueAtTime(0,time);
  gain.gain.linearRampToValueAtTime(accent?.22:.15,time+.002);
  gain.gain.exponentialRampToValueAtTime(.001,time+.055);
  oscillator.connect(gain);gain.connect(audioContext.destination);
  clicks.add(oscillator);
  oscillator.onended=()=>{if(!oscillator.cancelled&&oscillator.scheduledAt<=audioContext.currentTime)lastAudioBeat=Math.max(lastAudioBeat,beat);clicks.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  oscillator.scheduledBeat=beat;oscillator.scheduledAt=time;
  oscillator.start(time);oscillator.stop(time+.06);
 }
}
updateMetronome();
function updateTimer(){
 const seconds=mode==='challenge'?Math.max(0,Math.ceil(MAX_SECONDS-sessionSeconds)):Math.floor(sessionSeconds);
 $('training-time').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
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
// Sustain affects visual sounding notes only, never answer recognition.
let midiAccess=null,midiConnecting=false;
const midiInputs=new Map(),midiHeld=new Map(),midiPedals=new Map();
function paintMidi(){
 const held=new Set([...midiHeld.values()].flatMap(channels=>[...channels.values()].flatMap(keys=>[...keys])));
 const sustained=new Set([...midiPedals.values()].flatMap(channels=>[...channels.values()].flatMap(state=>[...state.notes])));
 for(const [note,key] of midiKeys){key.dataset.midiPressed=String(held.has(note));key.dataset.midiSustained=String(sustained.has(note)&&!held.has(note));}
}
function clearMidi(){midiHeld.clear();midiPedals.clear();paintMidi();}
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
 let pedals=midiPedals.get(id);if(!pedals){pedals=new Map();midiPedals.set(id,pedals);}
 let pedal=pedals.get(channel);if(!pedal){pedal={down:false,notes:new Set()};pedals.set(channel,pedal);}
 if(command===0x90&&velocity>0){const fresh=!keys.has(note);keys.add(note);pedal.notes.delete(note);if(fresh)judgeMidi(note);}
 else if(command===0x80||command===0x90){if(keys.delete(note)&&pedal.down)pedal.notes.add(note);}
 else if(note===64){pedal.down=velocity>=64;if(!pedal.down)pedal.notes.clear();}
 else if(note===121){pedal.down=false;pedal.notes.clear();}
 else if(note===120){keys.clear();pedal.notes.clear();}
 else if(note===123||(note>=124&&note<=127)){if(pedal.down)for(const key of keys)pedal.notes.add(key);keys.clear();}
 else return;
 paintMidi();
}
function judgeMidi(note){
 if(!running)return;
 advance(performance.now());
 if(!running||mode==='free')return;
 if(mode==='practice'){
  const held=[...midiHeld.values()].flatMap(channels=>[...channels.values()].flatMap(keys=>[...keys]));
  applyPracticeInput(cards,elapsed,sessionSeconds,note,held);
 }else for(const index of attackTargets(cards,sessionSeconds).indices){
  const card=cards[index];applyAttack(card,note);
  if(card.wrong&&!card.errorRecorded){card.errorRecorded=true;scheduler.record(card.id,'wrong');}
 }

 paintScene();
}

function syncMidiInputs(){
 const connected=new Map([...midiAccess.inputs.values()].filter(input=>input.state==='connected').map(input=>[input.id,input]));
 for(const [id,input] of midiInputs){
  if(connected.get(id)!==input){if(running)advance(performance.now());input.onmidimessage=null;midiInputs.delete(id);midiHeld.delete(id);midiPedals.delete(id);const active=cards[activeQuestionIndex(cards,sessionSeconds)];if(active)active.assisted=true;}
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
$('midi-warning-connect').addEventListener('click',event=>{event.stopPropagation();void connectMidi();});
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
  setStars(node.querySelector('.stars'),results[id]?.best.stars||undefined);
 }
 $('overlay-action').disabled=stageIndex<0||!selectable(stages[stageIndex],results);
 $('practice-action').hidden=!supportsPractice(stages[stageIndex]);
 scheduleRouteLayout();
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
 if(!visible){row.style.visibility='hidden';path.setAttribute('d','');return;}
 // Read geometry before changing styles so dragging does not force a second layout.
 const detail=$('route-details').getBoundingClientRect();
 const rowWidth=row.offsetWidth;
 const dot=row.children[0].querySelector('.route-dot').getBoundingClientRect();
 const x=center-bounds.left;
 row.style.visibility='visible';
 row.style.transform=`translateX(${center-detail.left-rowWidth/2}px)`;
 path.setAttribute('d',`M ${x} ${from.bottom-bounds.top} V ${(dot.top+dot.bottom)/2-bounds.top}`);
}
let routeLayoutPending=false;
function scheduleRouteLayout(){
 if(routeLayoutPending)return;
 routeLayoutPending=true;
 requestAnimationFrame(()=>{routeLayoutPending=false;syncProjectFromScroll();drawBranches();});
}
for(const row of routeRows)row.addEventListener('scroll',scheduleRouteLayout,{passive:true});
globalThis.addEventListener?.('resize',scheduleRouteLayout);
if(typeof ResizeObserver!=='undefined')new ResizeObserver(scheduleRouteLayout).observe($('route'));
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
 if(project&&project!==expandedTop){
  expandedTop=project;
  for(const item of curriculum){
   const button=stageButtons.get(item.id),active=item.id===project;
   button.setAttribute('aria-current',active?'location':'false');button.dataset.expanded=String(active);
  }
  revealProject();
 }
}
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
 mode='challenge';reset();focusCurrentStage();
 if(stageIndex<0)stageButtons.get(id)?.scrollIntoView?.({block:'nearest',inline:'center'});
 programmaticScrollLeft=routeRows[1].scrollLeft;
}
function selectStage(index){if(stages[index])selectNode(stages[index].id);}
$('version').textContent=`v${VERSION}+${BUILD_REVISION}`;
// Capture horizontal gestures across the content surface after a real drag.
let routeDrag=null,suppressRouteClick=false;
for(const route of [routeRows[0],$('route-surface')]){
const scrollRow=route===routeRows[0]?route:routeRows[1];
route.addEventListener('pointerdown',e=>{
 suppressRouteClick=false;
 if(e.pointerType==='mouse'&&e.button!==0)return;
 if(route===routeRows[0]&&e.pointerType!=='mouse')return;
 const coordinate=route===routeRows[0]?e.clientY:e.clientX;
 routeDrag={id:e.pointerId,x:coordinate,last:coordinate,moved:false};
});
route.addEventListener('pointermove',e=>{
 if(!routeDrag||routeDrag.id!==e.pointerId)return;
 const coordinate=route===routeRows[0]?e.clientY:e.clientX;
 const dx=coordinate-routeDrag.x;
 if(!routeDrag.moved&&Math.abs(dx)>6){routeDrag.moved=true;route.setPointerCapture(e.pointerId);route.dataset.dragging='true';}
 if(routeDrag.moved){
  e.preventDefault();
  const delta=routeDrag.last-coordinate;
  if(route===routeRows[0])scrollRow.scrollTop+=delta;
  else{scrollRow.scrollLeft+=delta;programmaticScrollLeft=null;}
  routeDrag.last=coordinate;
 }
});
function endRouteDrag(e){
 if(!routeDrag||routeDrag.id!==e.pointerId)return;
 suppressRouteClick=routeDrag.moved;routeDrag=null;route.dataset.dragging='false';
 if(route.hasPointerCapture(e.pointerId))route.releasePointerCapture(e.pointerId);
}
route.addEventListener('pointerup',endRouteDrag);route.addEventListener('pointercancel',endRouteDrag);
route.addEventListener('lostpointercapture',e=>{
 // Ignore a child button's implicit capture being transferred to this surface.
 if(e.target===route)endRouteDrag(e);
});
route.addEventListener('click',e=>{if(suppressRouteClick&&e.detail!==0){e.preventDefault();e.stopPropagation();suppressRouteClick=false;}},true);
}
$('route-surface').addEventListener('wheel',e=>{
 if(e.ctrlKey)return;
 const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
 if(!delta)return;
 e.preventDefault();programmaticScrollLeft=null;routeRows[1].scrollLeft+=delta*(e.deltaMode===1?16:e.deltaMode===2?routeRows[1].clientWidth:1);
},{passive:false});
document.addEventListener('dragstart',e=>e.preventDefault());
function hidePauseControls(){
 $('settings-toggle').hidden=true;
 for(const dot of answerDots.values())dot.hidden=true;
}
function openSettings(){
 if(running||$('settings-dialog').open)return;
 updateMetronome();$('bpm').value=String(bpm);
 $('tempo-setting').hidden=mode==='free';
 $('settings-dialog').showModal();
}

function showHome(){
 $('pause-screen').hidden=true;updateKeyboardBlur();hidePauseControls();$('overlay').hidden=false;$('settings-toggle').hidden=false;updateRoute();
}
// A card at index i touches the line at musical progress i + 2.
function canReachLine(index){
 if(mode==='practice')return true;
 return sessionSeconds+(index+2-elapsed)*240/bpm<MAX_SECONDS-1e-9;
}
function syncCards(){
 if(mode==='free')return;
 // Tempo changes can invalidate only the unlanded tail. Keep settled attempts.
 while(cards.length>settled&&cards.at(-1).startAt===undefined&&cards.length-1+2>elapsed&&!canReachLine(cards.length-1)){
  cards.pop();elements.pop();
  $('falling').replaceChildren(...elements);
 }
 while(elapsed+EPSILON>=cards.length&&canReachLine(cards.length))appendCard();
}
function updateTrainingHeader(){
 $('training-header').hidden=!started||finished;
 const stage=stages[stageIndex];
 const parent=nodeById.get(stage?.parent);
 $('training-name').textContent=mode==='free'?'自由弹奏':stage?(parent&&!parent.project?`${parent.name}-${stage.name}`:stage.name.replace(/\n/g,'')):'';
}
function showResult(result){
 setStars($('result-stars'),result.stars);
 $('result-accuracy').textContent=result.total?`${(result.accuracy*100).toFixed(1)}%`:'—';
 $('result-count').textContent=`${result.correct} / ${result.total}`;
 const seconds=Math.floor(result.seconds);
 $('result-duration').textContent=`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
 $('result-factors').textContent=`得分 ${Math.floor(result.score*10)/10} · 正确率 × 有效时长比例`;
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
 releaseScreenLock();stopMetronome();lastAudioBeat=-1;
 running=false;started=false;finished=false;$('pause-screen').hidden=true;elapsed=0;previous=0;sessionSeconds=0;settled=0;run=createRun();
 scheduler=mode!=='free'&&stageIndex>=0?new Scheduler(stages[stageIndex],{levels}):null;
 updateTrainingHeader();$('result-dialog').close();strikeFlashAt=-Infinity;$('strike').style.setProperty('--strike-flash','0');
 cards=[];elements=[];$('falling').replaceChildren();if(scheduler)appendCard();updateTimer();showHome();
}
function pause(){
 if(!running)return;advance(performance.now());if(!running)return;
 pauseSession();
}
function pauseSession(){
 if(mode==='practice')for(const card of cards)if(!isCorrect(card))card.hits.clear();
 running=false;strikeFlashAt=-Infinity;updateKeyboardBlur();releaseScreenLock();stopMetronome();
 $('overlay').hidden=true;
 hidePauseControls();$('pause-screen').hidden=false;
 paintScene();
}
function canStartTraining(){
 if((mode!=='free'&&!selectable(stages[stageIndex],results))||$('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return false;
 if([...midiInputs.values()].some(input=>input.state==='connected'))return true;
 $('midi-warning').showModal();return false;
}
function play(){
 if(running){pause();return;}
 if(!canStartTraining())return;
 if(finished)reset();
 keyboardBlurOn=mode==='challenge';
 $('pause-screen').hidden=true;
 run.started=true;started=true;running=true;
 syncCards();
 stampSessionBoundaries(elapsed,elapsed,sessionSeconds);settleAnswers();updateTimer();
 hidePauseControls();updateKeyboardBlur();previous=performance.now();unlockAudio();void keepScreenAwake();$('overlay').hidden=true;paintScene();
}
function complete(){
 if(!started||finished)return;
 if(mode==='challenge'){
  const active=cards[activeQuestionIndex(cards,sessionSeconds)];
  if(active&&!active.ended)settleCard(active);
 }
 running=false;finished=true;releaseScreenLock();stopMetronome();
 if(mode!=='challenge'){
  if($('settings-dialog').open)$('settings-dialog').close();
  elements.forEach(el=>{el.hidden=true;});
  updateTrainingHeader();
  strikeFlashAt=-Infinity;$('strike').style.setProperty('--strike-flash','0');
  showHome();focusCurrentStage();return;
 }
 const result=calculateScore(run),id=stages[stageIndex].id;
 results[id]={best:{stars:Math.max(result.stars,results[id]?.best.stars||0)}};
 save('voicing-stars',Object.fromEntries(Object.entries(results).map(([key,value])=>[key,value.best.stars])));
 if($('settings-dialog').open)$('settings-dialog').close();
 elements.forEach(el=>{el.hidden=true;});updateTrainingHeader();strikeFlashAt=-Infinity;$('strike').style.setProperty('--strike-flash','0');showHome();focusCurrentStage();showResult(result);
}
function settleCard(card){
 if(card.ended)return;
 card.ended=true;run.total++;
 if(isCorrect(card)){run.correct++;if(!card.assisted)scheduler.record(card.id,'correct');return;}
 if(!card.errorRecorded){card.errorRecorded=true;scheduler.record(card.id,'wrong');}

}
function settleAnswers(){
 if(mode!=='challenge')return;
 while(settled<cards.length&&canSettle(cards[settled],sessionSeconds)){
  settleCard(cards[settled++]);
 }
}
function stampSessionBoundaries(fromProgress,toProgress,fromSeconds){
 if(mode==='free')return;
 stampBoundaries(cards,fromProgress,toProgress,fromSeconds,bpm);
}
// Wall time counts practice effort; musical progress stops at unanswered gates.
// Both modes share stepping, queue generation and judgment boundary stamping.
function advance(now){
 if(!running){previous=now;return;}
 let remaining=Math.max(0,(now-previous)/1000);
 previous=now;
 if(mode==='free'){sessionSeconds+=remaining;updateTimer();return;}
 if(mode==='challenge')remaining=Math.min(remaining,MAX_SECONDS-sessionSeconds);
 while(remaining>EPSILON){
  syncCards();
  const fromProgress=elapsed,fromSeconds=sessionSeconds;
  const step=motionStep(elapsed,remaining,bpm,stopProgress(cards,mode));
  elapsed=step.progress;
  const consumed=step.frozen?remaining:Math.min(remaining,step.movingSeconds);
  sessionSeconds+=consumed;remaining=Math.max(0,remaining-consumed);
  syncCards();stampSessionBoundaries(fromProgress,elapsed,fromSeconds);settleAnswers();
  if(mode==='practice')updatePracticeState(cards,elapsed);
  cards.forEach((card,index)=>{
   if(card.fadeAt===undefined&&elapsed>=index+3-EPSILON&&(mode==='challenge'||card.practicePassed)){
    card.fadeAt=fromSeconds+Math.max(0,index+3-fromProgress)*240/bpm;
   }
  });
  const boundary=Math.floor(elapsed+EPSILON);
  if(boundary>=2&&boundary>Math.floor(fromProgress+EPSILON)&&cards[boundary-2]){
   strikeFlashAt=fromSeconds+(boundary-fromProgress)*240/bpm;
  }
 }
 if(mode==='challenge'){
  if(MAX_SECONDS-sessionSeconds<EPSILON)sessionSeconds=MAX_SECONDS;
  run.seconds=sessionSeconds;
  if(sessionSeconds>=MAX_SECONDS)complete();
 }
 updateTimer();
}
function paintScene(){
 updateTrainingHeader();
 const flash=running&&!finished?Math.max(0,1-(sessionSeconds-strikeFlashAt)/.18):0;
 $('strike').style.setProperty('--strike-flash',String(flash));
 if(!started||finished||mode==='free')return;
 syncCards();
 const height=$('falling').clientHeight,zoneHeight=$('performance-frost').clientHeight;
 const blocked=mode==='practice'?practiceBlockedIndex(cards):-1;
 cards.forEach((card,index)=>{
  const el=elements[index],geometry=labelGeometry(index,elapsed,height,zoneHeight);
  const opacity=card.fadeAt===undefined?1:Math.max(0,1-(sessionSeconds-card.fadeAt)/.18);
  el.hidden=geometry.hidden||opacity<=0;
  el.dataset.landed=String(geometry.landed);
  // During dual retries, only A shows errors; B stays neutral until it unlocks.
  el.dataset.feedback=blocked>=0&&index===blocked+1?'waiting':card.feedback||'waiting';
  el.style.opacity=String(opacity);el.style.transform=`translateY(${geometry.y}px)`;
 });
}
function render(now){
 advance(now);
 scheduleMetronome();
 paintScene();
 requestAnimationFrame(render);
}
$('bpm').addEventListener('change',()=>{
 bpm=normalizeBpm($('bpm').value);$('bpm').value=String(bpm);
 stopMetronome();syncCards();paintScene();
});
$('metronome').addEventListener('click',e=>{
 e.stopPropagation();metronomeOn=!metronomeOn;
 if(mode!=='challenge'||!started||finished)practiceSettings.metronomeOn=metronomeOn;
 stopMetronome();if(metronomeOn)unlockAudio();updateMetronome();
});
function startMode(nextMode){
 if(started&&!finished)return;
 if(nextMode==='practice'&&!supportsPractice(stages[stageIndex]))return;
 if(!canStartTraining())return;
 mode=nextMode;
 if(mode!=='challenge'){keyboardBlurOn=false;metronomeOn=practiceSettings.metronomeOn;}
 else{keyboardBlurOn=true;metronomeOn=true;}
 reset();play();
}
$('pause-screen').addEventListener('click',e=>e.stopPropagation());
$('pause-resume').addEventListener('click',e=>{e.stopPropagation();play();});
$('pause-settings').addEventListener('click',e=>{e.stopPropagation();openSettings();});
$('free-action').addEventListener('click',e=>{e.stopPropagation();startMode('free');});
$('pause-exit').addEventListener('click',e=>{e.stopPropagation();complete();});
$('practice-action').addEventListener('click',e=>{e.stopPropagation();startMode('practice');});
$('overlay-action').addEventListener('click',e=>{e.stopPropagation();startMode('challenge');});
$('settings-toggle').addEventListener('click',e=>{e.stopPropagation();openSettings();});
$('settings-dialog').addEventListener('click',e=>e.stopPropagation());
$('settings-close').addEventListener('click',e=>{e.stopPropagation();$('settings-dialog').close();});
$('result-dialog').addEventListener('click',e=>e.stopPropagation());
$('result-home').addEventListener('click',e=>{e.stopPropagation();$('result-dialog').close();});
$('result-retry').addEventListener('click',e=>{e.stopPropagation();$('result-dialog').close();play();});
$('overlay').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{
 if($('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return;
 if(running)pause();
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();clearMidi();}});
const portrait=matchMedia('(orientation: portrait) and (max-width: 1100px) and (any-pointer: coarse)');portrait.addEventListener('change',e=>{if(e.matches)pause();});
document.addEventListener('keydown',e=>{
 if($('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return;
 if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement?.tagName)){e.preventDefault();play();}
});
reset();focusCurrentStage();requestAnimationFrame(render);
