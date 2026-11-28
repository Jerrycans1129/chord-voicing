import {ChordRecognizer,LevelRecognizer} from './learning.js';
import {stages,names,qualities,curriculum,currentProgress,trainingItems} from './theory.js';
import {BUILD_REVISION} from './build.js';
import {Scheduler} from './scheduler.js';
import {VERSION,TOTAL_SECONDS,PRACTICE_SECONDS,questionScore,historyStats,grades,normalizeBpm,createRun,calculateScore,cleanResults} from './scoring.js';
import {activeQuestionIndex,prepareAttempt,stampBoundaries,attackTargets,targetForNote,applyAttack,applyPracticeInput,updatePracticeState,practiceBlockedIndex,isCorrect,canSettle} from './judgment.js';
import {motionStep,stopProgress,labelGeometry,metronomeBeats,EARLY_BARS,EPSILON} from './performance.js';
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
const recordsVersionKey='voicing-records-generation';
function clearStoredRecords(){
 // Only keys owned by this app are removed. Tips and the generation marker survive.
 for(let i=localStorage.length-1;i>=0;i--){
  const key=localStorage.key(i);
  if(key.startsWith('voicing-')&&key!==recordsVersionKey&&key!=='voicing-tips')localStorage.removeItem(key);
 }
}
let generation=read(recordsVersionKey,null);
if(!generation){
 try{clearStoredRecords();generation='routes-v1';save(recordsVersionKey,generation);}catch{generation='routes-v1';}
}
const recordKey=name=>'voicing-'+generation+'-'+name;
const results=cleanResults(read(recordKey('stars'),{}),stages.filter(s=>s.route==='train').map(s=>s.id));
const catalogue=stages.filter(stage=>stage.kind==='quality').flatMap(stage=>trainingItems(stage).sort((a,b)=>a.pc-b.pc||names[a.pc].indexOf(a.name)-names[b.pc].indexOf(b.name)||a.inv-b.inv));
const history=Object.create(null);
const defaultTips=[
 '熟练掌握不同和弦转位的手型，形成肌肉记忆。',
 '要训练从眼到手的条件反射，看到和弦记号不要经过大脑就能立马映射到键盘。',
 '练熟之后，试着眼睛不看键盘。',
 '盲弹时可以用黑键来辅助定位。',
 '注意力不要放在手，应该放在耳朵，用耳朵来弹奏。',
 '慢练！慢练！慢练！',
 '先练习用和弦谱看谱弹，然后才是级数功能谱，最后才是自己编配和弦',
 '直接开练和弦谱，告别C调键盘手，直接获取转调移调技能',
 '通过训练形成肌肉记忆后，弹奏时手是不用下意识的，就好像走路时腿不用下意识一样'
];
const storedTips=read('voicing-tips',defaultTips);
let tips=Array.isArray(storedTips)?storedTips.filter(t=>typeof t==='string'&&t.trim()):defaultTips;
let selection=null,sessionStage=null;
const freeSelection=new Set();
const inversionNames=['原位','第一转位','第二转位','第三转位'];
function countsFor(id){
 const counts=read(recordKey('history-'+id),history[id]);
 return historyStats(counts).total?counts:[0,0,0,0];
}
function remember(id,score){
 const epoch=generation;
 const update=()=>{if(read(recordsVersionKey,generation)!==epoch)return;const counts=countsFor(id);counts[grades.indexOf(score)]++;history[id]=counts;save(recordKey('history-'+id),counts);};
 if(globalThis.navigator?.locks)void navigator.locks.request('voicing-history-'+id,update);
 else update();
}
let stageIndex=currentProgress(results);
let selectedRoute=null;
let scheduler,settled=0,run=createRun();
let mode='challenge';
let learningActive=false,learningState=null,recognizer=null;
let bpm=120;
const practiceSettings={metronomeOn:true,bpm:90};
let cards=[],elements=[],elapsed=0,previous=0,running=false,started=false,finished=false;
let sessionSeconds=0,strikeFlashAt=-Infinity;
let practiceCountIn=null,frozenIdleSeconds=0;
const PRACTICE_IDLE_LIMIT=30;
const LABEL_FADE_SECONDS=.18;
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
 $('instrument').dataset.midiFeedback=String(learningActive||mode!=='practice');
 $('instrument').dataset.performance=String(!learningActive&&started&&!finished);
 $('instrument').dataset.challenge=String(mode==='challenge'&&started&&!finished);
 $('instrument').dataset.paused=String(started&&!finished&&!running);
 $('instrument').dataset.hideKeys=String(phoneLayout&&keyboardBlurOn);
 $('keyboard').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);
 $('keyboard-frost').hidden=phoneLayout||!keyboardBlurOn;
 $('keyboard-frost').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);

}
let metronomeOn=true;
let audioContext=null,nextAudioBeat=null,lastAudioBeat=-1,audioBarOffset=0;
const clicks=new Set();
function updateMetronome(){
 $('metronome').textContent=metronomeOn?'开':'关';
 $('metronome').setAttribute('aria-pressed',String(metronomeOn));
}
function stopMetronome(){
 for(const oscillator of clicks){if(oscillator.scheduledAt<=audioContext.currentTime)lastAudioBeat=Math.max(lastAudioBeat,oscillator.scheduledBeat);oscillator.cancelled=true;oscillator.stop();oscillator.disconnect();}
 clicks.clear();nextAudioBeat=null;
}
function releaseAudio(){
 stopMetronome();
 const context=audioContext;audioContext=null;
 // iOS can retain a silent/interrupted context after screen lock, even when
 // resume() resolves. Recreate it inside the next play/toggle user gesture.
 if(context&&context.state!=='closed')try{void context.close().catch(()=>{});}catch{}
}
function unlockAudio(){
 if(!metronomeOn)return;
 try{
  const Audio=globalThis.AudioContext||globalThis.webkitAudioContext;
  if(!Audio){metronomeOn=false;updateMetronome();return;}
  if(audioContext&&audioContext.state!=='running')releaseAudio();
  audioContext??=new Audio();
  const context=audioContext;
  context.resume().catch(()=>{
   // A late rejection from a discarded context must not stop its replacement.
   if(audioContext===context)releaseAudio();
  });
 }catch{releaseAudio();}
}
function scheduleMetronome(){
 if(!running||!metronomeOn||audioContext?.state!=='running')return;
 const recovery=practiceCountIn?.beats;
 // The count-in advances audio while the falling labels remain stationary.
 const audioProgress=elapsed+audioBarOffset+(recovery??0)/4;
 const audioStop=recovery===undefined?stopProgress(cards,mode)+audioBarOffset:elapsed+audioBarOffset+1;
 const schedule=metronomeBeats(audioProgress,bpm,nextAudioBeat??Math.max(Math.ceil(audioProgress*4-EPSILON),lastAudioBeat+1),audioStop);
 nextAudioBeat=schedule.nextBeat;
 for(const {beat,delay,accent} of schedule.events){
  const time=audioContext.currentTime+delay;
  const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();
  oscillator.frequency.setValueAtTime(accent?1400:1000,time);
  gain.gain.setValueAtTime(0,time);
  gain.gain.linearRampToValueAtTime(accent?.22:.15,time+.002);
  gain.gain.exponentialRampToValueAtTime(.001,time+.055);
  oscillator.connect(gain);gain.connect(audioContext.destination);
  clicks.add(oscillator);
  const context=audioContext;
  oscillator.onended=()=>{if(!oscillator.cancelled&&context===audioContext&&oscillator.scheduledAt<=context.currentTime)lastAudioBeat=Math.max(lastAudioBeat,beat);clicks.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  oscillator.scheduledBeat=beat;oscillator.scheduledAt=time;
  oscillator.start(time);oscillator.stop(time+.06);
 }
}
updateMetronome();
function updateTimer(){
 const seconds=Math.max(0,Math.ceil((mode==='challenge'?MAX_SECONDS:PRACTICE_SECONDS)-sessionSeconds));
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
function clearMidi(){midiHeld.clear();midiPedals.clear();recognizer?.reset();paintMidi();}
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
 if(command===0x90&&velocity>0){const fresh=!keys.has(note);keys.add(note);pedal.notes.delete(note);if(fresh)judgeMidi(note,id);}
 else if(command===0x80||command===0x90){if(keys.delete(note)&&pedal.down)pedal.notes.add(note);}
 else if(note===64){pedal.down=velocity>=64;if(!pedal.down)pedal.notes.clear();}
 else if(note===121){pedal.down=false;pedal.notes.clear();}
 else if(note===120){keys.clear();pedal.notes.clear();}
 else if(note===123||(note>=124&&note<=127)){if(pedal.down)for(const key of keys)pedal.notes.add(key);keys.clear();}
 else return;
 paintMidi();
}
function judgeMidi(note,deviceId){
 if(learningActive){
  if($('settings-dialog').open||$('midi-dialog').open)return;
  const held=[...midiHeld.values()].flatMap(channels=>[...channels.values()].flatMap(keys=>[...keys]));
  if(recognizer instanceof LevelRecognizer){
   const match=recognizer.attack(note,held,learningState.pc,learningState.q);
   // Let closely spaced MIDI attacks settle before displaying a partial chord.
   recognizer.pending=match?{match,after:performance.now()+55}:null;
  }else{
   showLearningMatch(recognizer?recognizer.attack(note,held,learningState.pc):{pc:note%12,inv:0});
  }
  return;
 }
 if(!running)return;
 advance(performance.now());
 if(!running)return;
 const held=[...midiHeld.values()].flatMap(channels=>[...channels.values()].flatMap(keys=>[...keys]));
 const active=cards[activeQuestionIndex(cards,sessionSeconds)];
 if(active&&deviceId){active.devices??=new Set();active.devices.add(deviceId);}
 if(mode==='practice'){
  frozenIdleSeconds=0;
  if(practiceCountIn){
   const target=cards[practiceCountIn.targetIndex];
   if(target?.startAt!==undefined)applyAttack(target,note,held);
  }else{
   const corrected=applyPracticeInput(cards,elapsed,sessionSeconds,note,held);
   if(corrected)startPracticeCountIn(corrected);
  }
 }else for(const index of attackTargets(cards,sessionSeconds).indices){
  const card=cards[index];applyAttack(card,note,held);
 }

 paintScene();
}

function syncMidiInputs(){
 const connected=new Map([...midiAccess.inputs.values()].filter(input=>input.state==='connected').map(input=>[input.id,input]));
 for(const [id,input] of midiInputs){
  if(connected.get(id)!==input){if(running)advance(performance.now());input.onmidimessage=null;midiInputs.delete(id);recognizer?.reset();midiHeld.delete(id);midiPedals.delete(id);const active=cards[activeQuestionIndex(cards,sessionSeconds)];if(active&&(!connected.size||active.devices?.has(id)))active.assisted=true;}
 }
 for(const [id,input] of connected){
  if(midiInputs.has(id))continue;
  midiInputs.set(id,input);input.onmidimessage=event=>receiveMidi(id,event);
 }
 if(started&&!finished&&running&&!midiInputs.size)pause();
 $('midi-status').textContent=midiInputs.size?`已连接：${[...midiInputs.values()].map(input=>input.name||'MIDI 输入设备').join('、')}`:'已启用 · 未发现 MIDI 输入，请连接键盘';
 for(const id of ['settings-toggle','learning-midi']){
  $(id).dataset.connected=String(midiInputs.size>0);
  $(id).setAttribute('aria-label',(id==='settings-toggle'?'系统设置，':'')+(midiInputs.size?'MIDI 已连接':'MIDI 未连接'));
 }
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
const stageButtons=new Map();
function setStars(element,value){
 element.replaceChildren();element.setAttribute('role','img');element.setAttribute('aria-label',value===undefined?'':`${value} 星`);
 if(value===undefined)return;
 const base=document.createElement('span');base.className='stars-base';base.textContent='★★★';base.setAttribute('aria-hidden','true');
 const fill=document.createElement('span');fill.className='stars-fill';fill.textContent='★★★';fill.setAttribute('aria-hidden','true');fill.style.width=`${value/3*100}%`;
 element.append(base,fill);
}
const surface=$('route-surface');
for(const phase of curriculum){
 const group=document.createElement('div');group.className='route-phase';
 for(const route of ['learn','train']){
  const row=document.createElement('div');row.className='phase-row '+route;
  for(const stage of phase[route]){
   const button=document.createElement('button');button.type='button';button.className='route-node';
   button.dataset.id=stage.id;button.dataset.comprehensive=String(!!stage.comprehensive);
   const dot=document.createElement('span');dot.className='route-dot';
   const label=document.createElement('span');label.className='route-name';label.textContent=stage.name;
   dot.append(label);button.append(dot);
   if(route==='train'){const stars=document.createElement('span');stars.className='stars';button.append(stars);}
   button.addEventListener('click',()=>selectNode(stage.id));
   stageButtons.set(stage.id,button);row.append(button);
  }
  group.append(row);
 }
 surface.append(group);
}
function updateRoute(){
 const recommended=stages[currentProgress(results)];
 for(const stage of stages){
  const button=stageButtons.get(stage.id);
  button.setAttribute('aria-current',selectedRoute&&stage===stages[stageIndex]?'step':'false');
  button.dataset.recommended=String(stage===recommended);
  button.setAttribute('aria-label',stage.name+(stage===recommended?' · 推荐练习':''));
  if(stage.route==='train')setStars(button.querySelector('.stars'),results[stage.id]?.best.stars);
 }
 for(const [id,route] of [['learn-action','learn'],['practice-action','train']]){
  $(id).disabled=route!==selectedRoute;
  $(id).setAttribute('aria-pressed',String(route===selectedRoute));
 }
}
function focusCurrentStage(){stageButtons.get(stages[stageIndex].id).scrollIntoView?.({block:'nearest',inline:'center'});}
function selectNode(id){
 if(started&&!finished)return;
 const index=stages.findIndex(stage=>stage.id===id);
 if(index<0)return;
 stageIndex=index;selectedRoute=stages[index].route;
 selection=null;sessionStage=null;mode='challenge';reset();focusCurrentStage();
}
$('version').textContent=`v${VERSION}+${BUILD_REVISION}`;
// Capture horizontal gestures across the content surface after a real drag.
let routeDrag=null,suppressRouteClick=false;
surface.addEventListener('pointerdown',e=>{
 suppressRouteClick=false;
 if(e.pointerType==='mouse'&&e.button!==0)return;
 const coordinate=e.clientX;
 routeDrag={id:e.pointerId,x:coordinate,last:coordinate,moved:false};
});
surface.addEventListener('pointermove',e=>{
 if(!routeDrag||routeDrag.id!==e.pointerId)return;
 const coordinate=e.clientX;
 const dx=coordinate-routeDrag.x;
 if(!routeDrag.moved&&Math.abs(dx)>6){routeDrag.moved=true;surface.setPointerCapture(e.pointerId);surface.dataset.dragging='true';}
 if(routeDrag.moved){
  e.preventDefault();
  const delta=routeDrag.last-coordinate;
  surface.scrollLeft+=delta;
  routeDrag.last=coordinate;
 }
});
function endRouteDrag(e){
 if(!routeDrag||routeDrag.id!==e.pointerId)return;
 suppressRouteClick=routeDrag.moved;routeDrag=null;surface.dataset.dragging='false';
 if(surface.hasPointerCapture(e.pointerId))surface.releasePointerCapture(e.pointerId);
}
surface.addEventListener('pointerup',endRouteDrag);surface.addEventListener('pointercancel',endRouteDrag);
surface.addEventListener('lostpointercapture',e=>{
 // Ignore a child button's implicit capture being transferred to this surface.
 if(e.target===surface)endRouteDrag(e);
});
surface.addEventListener('click',e=>{if(suppressRouteClick&&e.detail!==0){e.preventDefault();e.stopPropagation();suppressRouteClick=false;}},true);
surface.addEventListener('wheel',e=>{
 if(e.ctrlKey)return;
 const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;
 if(!delta)return;
 e.preventDefault();surface.scrollLeft+=delta*(e.deltaMode===1?16:e.deltaMode===2?surface.clientWidth:1);
},{passive:false});
document.addEventListener('dragstart',e=>e.preventDefault());
function hidePauseControls(){
 $('free-action').hidden=true;$('settings-toggle').hidden=true;
 for(const dot of answerDots.values())dot.hidden=true;
}
function inPracticeSession(){return mode==='practice'&&started&&!finished;}
function openSettings(){
 if(running||$('settings-dialog').open||(mode==='challenge'&&started&&!finished))return;
 recognizer?.reset();
 updateMetronome();updateTempoControls();
 $('practice-start').hidden=inPracticeSession();
 $('settings-dialog').showModal();
}

function closeLearning(){
 learningActive=false;recognizer=null;learningState=null;$('learning').hidden=true;$('instrument').dataset.learning='false';
}
function showHome(){
 closeLearning();
 $('practice-count-in').hidden=true;
 $('pause-screen').hidden=true;updateKeyboardBlur();hidePauseControls();$('overlay').hidden=false;$('settings-toggle').hidden=false;$('free-action').hidden=false;updateRoute();
}
// A card at index i touches the line at musical progress i + 2.
function canReachLine(index){
 if(mode==='practice')return true;
 if(sessionSeconds>=MAX_SECONDS)return false;
 return sessionSeconds+(index+2-elapsed)*240/bpm<MAX_SECONDS-1e-9;
}
function syncCards(){
 // Tempo changes can invalidate only the unlanded tail. Keep settled attempts.
 while(cards.length>settled&&cards.at(-1).startAt===undefined&&cards.length-1+2>elapsed&&!canReachLine(cards.length-1)){
  cards.pop();elements.pop();
  $('falling').replaceChildren(...elements);
 }
 while(elapsed+EPSILON>=cards.length&&canReachLine(cards.length))appendCard();
}
function updateTrainingHeader(){
 $('training-header').hidden=learningActive||!started||finished;
 const stage=sessionStage??stages[stageIndex];
 $('training-name').textContent=stage?.name.replace(/\n/g,'')??'';
}
function showResult(result){
 const challenge=mode==='challenge';
 $('result-title').textContent=challenge?'闯关成绩':'训练总结';
 $('result-node').textContent=(sessionStage??stages[stageIndex]).name.replace(/\n/g,' ');
 $('result-stars').hidden=!challenge;$('score-row').hidden=!challenge;
 setStars($('result-stars'),result.stars);
 $('result-score').textContent=String(Math.floor(result.score*10)/10);
 $('result-accuracy').textContent=result.total?percent(result.accuracy):'—';
 const seconds=Math.floor(result.seconds);
 $('result-duration').textContent=`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
 const rows=[...run.items.values()].sort((a,b)=>a.points/a.total-b.points/b.total);
 $('result-items').replaceChildren(...rows.map(({item,points,total})=>{
  const row=document.createElement('tr'),name=document.createElement('td'),rate=document.createElement('td');
  name.append(itemLabel(item));if(item.kind==='chord'&&!item.freeOctaves)name.append(inversionNames[item.inv]);
  rate.textContent=percent(points/total);row.append(name,rate);return row;
 }));
 $('result-tip').textContent=tips[Math.floor(Math.random()*tips.length)]??'';
 $('result-dialog').showModal();
}
function percent(value){return (value*100).toFixed(1)+'%';}
function cardElement(card){
  const el=document.createElement('div');el.className='card';el.dataset.inv=card.inv;el.dataset.freeOctaves=String(!!card.freeOctaves);el.dataset.size=card.kind==='note'?1:qualities[card.q].intervals.length;

  if(card.kind!=='note'){
   const bounds=keyBounds.get(card.root??48);
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
 return el;
}
function appendCard(){
 const card=prepareAttempt(scheduler.next());
 const el=cardElement(card);el.style.left=`${centers.get(card.root)*100}%`;el.hidden=true;
  $('falling').append(el);elements.push(el);cards.push(card);
}
function reset(){
 practiceCountIn=null;frozenIdleSeconds=0;
 releaseScreenLock();stopMetronome();lastAudioBeat=-1;audioBarOffset=0;
 running=false;started=false;finished=false;$('pause-screen').hidden=true;elapsed=0;previous=0;sessionSeconds=0;settled=0;run=createRun();run.items=new Map();
 const stage=sessionStage??stages[stageIndex];
 if(stage&&mode==='practice')for(const item of stage.items??trainingItems(stage))history[item.id]=countsFor(item.id);
 scheduler=stage?new Scheduler(stage,{history:mode==='practice'?history:null}):null;
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
 hidePauseControls();$('pause-screen').hidden=mode==='practice';
 if(mode==='practice'){
  const card=cards[practiceReplayIndex()];
  if(!card.recorded)card.assisted=true;
  openLearning(card.q,card.pc,card.inv??0,names[card.pc].indexOf(card.name));
 }
 paintScene();
}
function practiceReplayIndex(){
 const blocked=practiceBlockedIndex(cards);
 if(practiceCountIn)return Math.max(0,practiceCountIn.targetIndex);
 if(blocked>=0)return blocked;
 return Math.max(0,Math.floor(elapsed+EPSILON)-2);
}
function rewindPractice(){
 const index=practiceReplayIndex();
 // Before the first label reaches the zone, replay its current approach bar.
 elapsed=Math.min(Math.floor(elapsed+EPSILON),index+2);
 for(const card of cards.slice(index)){
  card.hits.clear();
  card.wrong=false;
  for(const field of ['startAt','endAt','firstBeatCorrect','feedback','practiceClosed','practicePassed','practiceRetryStarted','fadeAt','attempted','devices'])delete card[field];
 }
 if(index>0){
  const previousCard=cards[index-1];
  previousCard.practicePassed=true;
  previousCard.fadeAt=sessionSeconds-LABEL_FADE_SECONDS;
 }
 audioBarOffset=0;
}
function startPracticeCountIn(correctedCard=null){
 // At a bar line, the label entering the performance zone has index elapsed - 2.
 practiceCountIn={beats:0,targetIndex:Math.round(elapsed)-2,correctedCard};
 frozenIdleSeconds=0;stopMetronome();lastAudioBeat=-1;scheduleMetronome();
}
function canStartTraining(){
 if(portrait.matches||$('midi-warning').open||$('settings-dialog').open||$('result-dialog').open)return false;
 if([...midiInputs.values()].some(input=>input.state==='connected'))return true;
 $('midi-warning').showModal();return false;
}
function play(){
 if(running){pause();return;}
 if(!canStartTraining())return;
 if(finished)reset();
 const resumingPractice=learningActive&&inPracticeSession();
 if(resumingPractice)rewindPractice();
 if(learningActive)closeLearning();
 keyboardBlurOn=mode==='challenge';
 $('pause-screen').hidden=true;
 run.started=true;started=true;running=true;
 syncCards();
 if(!resumingPractice)stampSessionBoundaries(elapsed,elapsed,sessionSeconds);
 settleAnswers();updateTimer();
 hidePauseControls();updateKeyboardBlur();previous=performance.now();unlockAudio();void keepScreenAwake();$('overlay').hidden=true;
 if(resumingPractice)startPracticeCountIn();
 paintScene();
}
function complete(){
 if(!started||finished)return;
 running=false;finished=true;releaseScreenLock();stopMetronome();
 run.seconds=sessionSeconds;
 const result=calculateScore(run);
 if(mode==='challenge'&&(sessionStage??stages[stageIndex]).route==='train'&&read(recordsVersionKey,generation)===generation){
  const id=(sessionStage??stages[stageIndex]).id;
  const saved=read(recordKey('stars'),{});
  const best=Math.max(result.stars,Number(saved?.[id])||0,results[id]?.best.stars||0);
  results[id]={best:{stars:best}};save(recordKey('stars'),{...saved,[id]:best});
 }
 if($('settings-dialog').open)$('settings-dialog').close();
 elements.forEach(el=>{el.hidden=true;});updateTrainingHeader();
 strikeFlashAt=-Infinity;$('strike').style.setProperty('--strike-flash','0');showHome();focusCurrentStage();showResult(result);
}
function settleCard(card){
 if(card.recorded)return;
 card.recorded=true;
 if(mode==='challenge')card.ended=true;
 if(card.assisted)return;
 const score=card.attempted?questionScore(card.firstBeatCorrect,isCorrect(card)):0;
 run.total++;run.correct+=score;
 const entry=run.items.get(card.id)??{item:card,total:0,points:0};
 entry.total++;entry.points+=score;run.items.set(card.id,entry);
 if(card.attempted){scheduler.record(card.id,score);remember(card.id,score);}
}
function settleAnswers(){
 while(settled<cards.length&&canSettle(cards[settled],sessionSeconds))settleCard(cards[settled++]);
}
function stampSessionBoundaries(fromProgress,toProgress,fromSeconds){
 const blocked=mode==='practice'?practiceBlockedIndex(cards):-1;
 if(blocked>=0&&fromProgress>=blocked+3-EPSILON)return;
 stampBoundaries(cards,fromProgress,toProgress,fromSeconds,bpm);
}
// Wall time counts practice effort; musical progress stops at unanswered gates.
// Both modes share stepping, queue generation and judgment boundary stamping.
function advance(now){
 if(!running){previous=now;return;}
 const limit=mode==='practice'?PRACTICE_SECONDS:MAX_SECONDS;
 let remaining=Math.min(limit-sessionSeconds,Math.max(0,(now-previous)/1000));
 previous=now;
 while(remaining>EPSILON){
  syncCards();
  if(practiceCountIn){
   const consumed=Math.min(remaining,(4-practiceCountIn.beats)*60/bpm);
   const before=practiceCountIn.beats;
   practiceCountIn.beats=Math.min(4,before+consumed*bpm/60);
   const next=cards[practiceCountIn.targetIndex];
   if(next&&next.startAt===undefined&&practiceCountIn.beats>=(4-EARLY_BARS*4)-EPSILON){
    next.startAt=sessionSeconds+Math.max(0,(4-EARLY_BARS*4)-before)*60/bpm;
   }
   sessionSeconds+=consumed;remaining=Math.max(0,remaining-consumed);
   if(practiceCountIn.beats>=4-EPSILON){
    if(practiceCountIn.correctedCard)practiceCountIn.correctedCard.practicePassed=true;
    practiceCountIn=null;
    audioBarOffset++;strikeFlashAt=sessionSeconds;
   }
   continue;
  }
  const fromProgress=elapsed,fromSeconds=sessionSeconds;
  const step=motionStep(elapsed,remaining,bpm,stopProgress(cards,mode));
  elapsed=step.progress;
  const waiting=step.frozen&&step.movingSeconds<=EPSILON;
  const consumed=waiting?Math.min(remaining,PRACTICE_IDLE_LIMIT-frozenIdleSeconds):Math.min(remaining,step.movingSeconds);
  if(waiting)frozenIdleSeconds+=consumed;
  sessionSeconds+=consumed;remaining=Math.max(0,remaining-consumed);
  syncCards();stampSessionBoundaries(fromProgress,elapsed,fromSeconds);settleAnswers();
  if(mode==='practice')updatePracticeState(cards,elapsed);
  cards.forEach((card,index)=>{
   if(card.fadeAt===undefined&&elapsed>=index+3-EPSILON&&(mode==='challenge'||card.practicePassed)){
    card.fadeAt=fromSeconds+Math.max(0,index+3-fromProgress)*240/bpm;
   }
  });
  if(frozenIdleSeconds>=PRACTICE_IDLE_LIMIT&&sessionSeconds<limit-EPSILON){pauseSession();break;}
  const boundary=Math.floor(elapsed+EPSILON);
  if(boundary>=2&&boundary>Math.floor(fromProgress+EPSILON)&&cards[boundary-2]&&elapsed<stopProgress(cards,mode)-EPSILON){
   strikeFlashAt=fromSeconds+(boundary-fromProgress)*240/bpm;
  }
 }
 run.seconds=Math.min(sessionSeconds,limit);
 if(sessionSeconds>=limit-EPSILON){sessionSeconds=limit;complete();}
 updateTimer();
}
function paintScene(){
 updateTrainingHeader();
 // Opening labels travel for eight beats; cue the final bar before contact.
 const openingBeats=elapsed>=1-EPSILON&&elapsed<2-EPSILON?Math.max(0,(elapsed-1)*4):undefined;
 const cueBeats=practiceCountIn?.beats??openingBeats;
 const countIn=$('practice-count-in');
 countIn.hidden=!running||finished||cueBeats===undefined||cueBeats>=4-EPSILON;
 if(!countIn.hidden){
  const label=['3','2','1','GO!'][Math.min(3,Math.floor(cueBeats+EPSILON))];
  if(countIn.textContent!==label)countIn.textContent=label;
 }
 const flash=running&&!finished?Math.max(0,1-(sessionSeconds-strikeFlashAt)/.18):0;
 $('strike').style.setProperty('--strike-flash',String(flash));
 if(!started||finished)return;
 syncCards();
 const height=$('falling').clientHeight,zoneHeight=$('performance-frost').clientHeight;
 const blocked=mode==='practice'?practiceBlockedIndex(cards):-1;
 cards.forEach((card,index)=>{
  const el=elements[index],geometry=labelGeometry(index,elapsed,height,zoneHeight);
  const opacity=card.fadeAt===undefined?1:Math.max(0,1-(sessionSeconds-card.fadeAt)/LABEL_FADE_SECONDS);
  el.hidden=geometry.hidden||opacity<=EPSILON;
  el.dataset.landed=String(geometry.landed);
  // B stays neutral until its early window opens at the end of the count-in.
  el.dataset.feedback=blocked>=0&&index===blocked+1&&(!practiceCountIn||card.startAt===undefined)?'waiting':card.feedback||'waiting';
  el.style.opacity=String(opacity);el.style.transform=`translateY(${geometry.y}px)`;
 });
}
function render(now){
 if(recognizer?.pending&&now>=recognizer.pending.after){
  const {match}=recognizer.pending;recognizer.pending=null;
  if(!$('settings-dialog').open&&!$('midi-dialog').open)showLearningMatch(match);
 }
 advance(now);
 scheduleMetronome();
 paintScene();
 requestAnimationFrame(render);
}
function updateTempoControls(){
 $('bpm').textContent=String(practiceSettings.bpm);
 $('bpm-decrease').disabled=practiceSettings.bpm<=40;
 $('bpm-increase').disabled=practiceSettings.bpm>=180;
}
for(const [id,delta] of [['bpm-decrease',-10],['bpm-increase',10]])$(id).addEventListener('click',e=>{
 e.stopPropagation();
 if(running||(mode==='challenge'&&started&&!finished))return;
 practiceSettings.bpm=normalizeBpm(practiceSettings.bpm+delta);
 if(mode==='practice')bpm=practiceSettings.bpm;
 updateTempoControls();stopMetronome();syncCards();paintScene();
});
$('metronome').addEventListener('click',e=>{
 e.stopPropagation();if(mode==='challenge'&&started&&!finished)return;metronomeOn=!metronomeOn;
 if(mode!=='challenge'||!started||finished)practiceSettings.metronomeOn=metronomeOn;
 stopMetronome();if(metronomeOn)unlockAudio();updateMetronome();
});
function startMode(nextMode){
 if(started&&!finished)return;
 if(nextMode==='challenge'&&(selection??stages[stageIndex]).route!=='train')return;
 if(!canStartTraining())return;
 sessionStage=selection??stages[stageIndex];
 mode=nextMode;
 if(mode!=='challenge'){bpm=practiceSettings.bpm;keyboardBlurOn=false;metronomeOn=practiceSettings.metronomeOn;}
 else{bpm=120;keyboardBlurOn=true;metronomeOn=true;}
 reset();play();
}
$('pause-screen').addEventListener('click',e=>e.stopPropagation());
$('pause-resume').addEventListener('click',e=>{e.stopPropagation();play();});

function startLearning(stage=stages[stageIndex]){
 if(started&&!finished)return;
 selection=stage;sessionStage=null;mode='practice';
 started=false;finished=false;bpm=practiceSettings.bpm;metronomeOn=practiceSettings.metronomeOn;
 const item=(stage.items??trainingItems(stage))[0];
 openLearning(item.q,item.pc,item.inv??0,names[item.pc].indexOf(item.name));
}
function openLearning(q,pc,inv,spelling){
 const stage=sessionStage??selection??stages[stageIndex];
 const pool=trainingItems(stage);
 const poolQualities=new Set(pool.map(item=>item.q));
 // Free practice keeps its category browser independent of the selected exercise cells.
 const previewItems=stage.route?pool:catalogue.filter(item=>poolQualities.has(item.q));
 const browseRoute=stage.route==='learn'&&q!==undefined&&!inPracticeSession();
 const kinds=browseRoute?stages.filter(s=>s.kind==='quality').map(s=>s.combos[0].q):
  [...new Set(previewItems.filter(item=>item.kind==='chord').map(item=>item.q))];
 learningState={q,pc,inv,spelling,kinds,previewItems,browseRoute,expanded:false};
 recognizer=q===undefined?null:stage.route==='train'&&kinds.length>1?new LevelRecognizer(kinds):new ChordRecognizer(q);
 $('preview-node').textContent=stage.route==='train'?stage.name.replace(/\n/g,' '):'';
 $('overlay-action').hidden=stage.route!=='train'||inPracticeSession();
 learningActive=true;keyboardBlurOn=false;updateKeyboardBlur();
 $('instrument').dataset.learning='true';$('overlay').hidden=true;$('learning').hidden=false;$('settings-toggle').hidden=true;
 $('learning-back').textContent='退出';$('learning-settings').textContent=inPracticeSession()?'训练设置':'30分钟专注训练';$('free-action').hidden=true;
 $('learning-title').textContent=q===undefined?'单音识别':qualities[q].name+'和弦';
 $('learning-title').hidden=kinds.length>1;
 $('quality-picker').hidden=kinds.length<2;
 qualityDrag=null;skipQualityClick=false;
 if(kinds.length>1)paintQualityPicker();
 const buttons=[];
 const whiteColumns=[1,3,5,7,9,11,13],blackColumns={1:2,3:4,6:8,8:10,10:12};
 names.forEach((spellings,pc)=>spellings.forEach((name,spelling)=>{
  const button=document.createElement('button');button.className='learning-chord';
  button.style.gridColumn=String(blackColumns[pc]??whiteColumns[[0,2,4,5,7,9,11].indexOf(pc)]);
  button.style.gridRow=String(blackColumns[pc]?spelling+1:3);
  button.dataset.pc=String(pc);button.dataset.spelling=String(spelling);
  button.addEventListener('click',()=>{Object.assign(learningState,{pc,spelling});recognizer?.reset();paintLearning();});buttons.push(button);
 }));
 $('learning-chords').replaceChildren(...buttons);
 paintLearning();
}
function showLearningMatch(match){
 if(!match)return;
 const q=match.q??learningState.q;
 if(!learningState.previewItems.some(item=>item.pc===match.pc&&item.q===q))return;
 if(q===learningState.q&&match.pc===learningState.pc&&match.inv===learningState.inv)return;
 if(q!==learningState.q)changeLearningQuality(q);
 if(match.pc!==learningState.pc)learningState.spelling=Math.floor(Math.random()*names[match.pc].length);
 Object.assign(learningState,match);
 paintLearning();
}
function paintLearning(){
 if(!learningActive)return;
 const {q,pc}=learningState;
 for(const button of $('learning-chords').children){
  const root=Number(button.dataset.pc);
  button.textContent=names[root][Number(button.dataset.spelling)]+(qualities[q]?.suffix??'');
  button.hidden=!learningState.previewItems.some(item=>item.q===q&&item.name===names[root][Number(button.dataset.spelling)]);
  button.dataset.long=String(button.textContent.length>7);
  button.setAttribute('aria-pressed',String(root===pc));
 }
 const tones=new Set((qualities[q]?.intervals??[0]).map(interval=>(pc+interval)%12));
 for(const [note,dot] of answerDots){
  const pitchClass=note%12;
  dot.hidden=!tones.has(pitchClass);
  dot.dataset.root=String(pitchClass===pc);
 }
}
$('learning').addEventListener('click',e=>{
 e.stopPropagation();
 if(learningActive&&inPracticeSession()&&!e.target.closest('button,select')&&!$('settings-dialog').open)play();
});
$('learning-back').addEventListener('click',()=>inPracticeSession()?complete():showHome());
$('learning-midi').addEventListener('click',openMidi);
$('learning-settings').addEventListener('click',openSettings);
const picker=$('quality-picker'),track=$('quality-track');
let qualityDrag=null,skipQualityClick=false;
function qualityAt(offset){
 const {q,kinds}=learningState;
 return kinds[(kinds.indexOf(q)+offset+kinds.length*2)%kinds.length];
}
function paintQualityPicker(){
 const {expanded}=learningState;
 picker.dataset.expanded=String(expanded);
 track.style.transform='';
 for(const button of track.children){
  const offset=Number(button.dataset.offset);
  button.textContent=qualities[qualityAt(offset)].name+'和弦';
  button.disabled=offset!==0&&!expanded;
  button.tabIndex=offset===0?0:-1;
  if(offset===0)button.setAttribute('aria-expanded',String(expanded));
 }
}
function changeLearningQuality(q,direction,dragOffset=0){
 const {kinds}=learningState;
 const distance=kinds.indexOf(q)-kinds.indexOf(learningState.q);
 const step=direction??Math.sign(Math.abs(distance)>kinds.length/2?-distance:distance);
 if(learningState.browseRoute){
  stageIndex=stages.findIndex(stage=>stage.kind==='quality'&&stage.combos[0].q===q);
  selection=stages[stageIndex];learningState.previewItems=trainingItems(selection);
 }
 const candidates=learningState.previewItems.filter(item=>item.q===q);
 const root=candidates.find(item=>item.pc===learningState.pc)??candidates[0];
 Object.assign(learningState,{q,inv:0,pc:root.pc,spelling:names[root.pc].indexOf(root.name)});
 if(!(recognizer instanceof LevelRecognizer))recognizer=new ChordRecognizer(q);
 qualityDrag=null;
 paintQualityPicker();
 if(step&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
  track.animate?.([{transform:`translateX(${step*picker.clientWidth/3+dragOffset}px)`},{transform:'translateX(0)'}],{duration:180,easing:'ease-out'});
 }
}
function selectNeighbor(offset,dragOffset=0){
 recognizer?.reset();
 changeLearningQuality(qualityAt(offset),offset,dragOffset);
 paintLearning();
}
for(const offset of [-2,-1,0,1,2]){
 const button=document.createElement('button');button.type='button';button.dataset.offset=String(offset);
 button.addEventListener('click',event=>{
  if(skipQualityClick&&event.detail)return;
  if(offset===0){learningState.expanded=!learningState.expanded;paintQualityPicker();}
  else if(learningState.expanded)selectNeighbor(offset);
 });
 track.append(button);
}
picker.addEventListener('click',event=>event.stopPropagation());
picker.addEventListener('keydown',event=>{
 if(learningState.expanded&&['ArrowLeft','ArrowRight'].includes(event.key)){
  event.preventDefault();selectNeighbor(event.key==='ArrowLeft'?-1:1);
 }
});
picker.addEventListener('pointerdown',event=>{
 skipQualityClick=false;
 if(!learningState.expanded||!event.isPrimary||event.button!==0)return;
 qualityDrag={id:event.pointerId,x:event.clientX};
});
picker.addEventListener('pointermove',event=>{
 if(qualityDrag?.id!==event.pointerId)return;
 const dx=event.clientX-qualityDrag.x;
 if(!skipQualityClick&&Math.abs(dx)<6)return;
 skipQualityClick=true;
 picker.setPointerCapture(event.pointerId);
 const limit=picker.clientWidth/3;
 track.style.transform=`translateX(${Math.max(-limit,Math.min(limit,dx))}px)`;
});
function finishQualityDrag(event){
 if(qualityDrag?.id!==event.pointerId)return;
 const dx=event.clientX-qualityDrag.x;
 qualityDrag=null;
 track.style.transform='';
 if(event.type==='pointerup'&&skipQualityClick&&Math.abs(dx)>Math.min(32,picker.clientWidth/9)){
  const limit=picker.clientWidth/3;
  selectNeighbor(dx<0?1:-1,Math.max(-limit,Math.min(limit,dx)));
 }
}
picker.addEventListener('pointerup',finishQualityDrag);
picker.addEventListener('pointercancel',finishQualityDrag);
picker.addEventListener('pointerleave',event=>{
 if(!picker.hasPointerCapture(event.pointerId))finishQualityDrag(event);
});


$('pause-exit').addEventListener('click',e=>{e.stopPropagation();complete();});
$('learn-action').addEventListener('click',e=>{e.stopPropagation();startLearning();});
$('practice-action').addEventListener('click',e=>{e.stopPropagation();startLearning();});
$('overlay-action').addEventListener('click',e=>{e.stopPropagation();startMode('challenge');});
$('settings-toggle').addEventListener('click',e=>{e.stopPropagation();$('system-dialog').showModal();});
$('settings-dialog').addEventListener('click',e=>e.stopPropagation());
$('settings-close').addEventListener('click',e=>{e.stopPropagation();$('settings-dialog').close();});
$('result-dialog').addEventListener('click',e=>e.stopPropagation());
$('result-home').addEventListener('click',e=>{e.stopPropagation();$('result-dialog').close();});
$('result-retry').addEventListener('click',e=>{e.stopPropagation();$('result-dialog').close();if(mode==='practice')startLearning(sessionStage);else startMode('challenge');});
$('overlay').addEventListener('click',e=>e.stopPropagation());
document.addEventListener('click',()=>{
 if($('midi-warning').open||$('midi-dialog').open||$('settings-dialog').open||$('result-dialog').open)return;
 if(running)pause();
});
function backgroundSession(){pause();clearMidi();releaseAudio();}
document.addEventListener('visibilitychange',()=>{if(document.hidden)backgroundSession();});
globalThis.addEventListener?.('pagehide',backgroundSession);
const portrait=matchMedia('(orientation: portrait) and (max-width: 1100px) and (any-pointer: coarse)');portrait.addEventListener('change',e=>{if(e.matches)pause();});
document.addEventListener('keydown',e=>{
 if(!started||finished||e.repeat)return;
 if($('midi-warning').open||$('midi-dialog').open||$('settings-dialog').open||$('result-dialog').open)return;
 if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement?.tagName)){e.preventDefault();play();}
});
function itemLabel(item){
 const wrap=document.createElement('span');wrap.className='item-label';wrap.append(cardElement(item));return wrap;
}
function option(value,text){
 const el=document.createElement('option');el.value=String(value);el.textContent=text;return el;
}
function openMidi(){if(!$('midi-dialog').open)$('midi-dialog').showModal();}
function filteredItems(){
 const query=$('free-filter').value.trim().replace(/^([A-Ga-g])b/, '$1♭').replaceAll('#','♯').toLowerCase();
 const quality=$('free-quality').value,inv=$('free-inv').value;
 return catalogue.filter(i=>(!quality||String(i.q)===quality)&&(!inv||(!i.freeOctaves&&String(i.inv)===inv))&&i.label.toLowerCase().includes(query));
}
function renderFree(){
 const groups=new Map();
 for(const item of filteredItems()){
  const row=groups.get(item.label)??[];row[item.inv]=item;groups.set(item.label,row);
 }
 const head=document.createElement('thead'),titles=document.createElement('tr');
 for(const title of ['和弦',...inversionNames]){const th=document.createElement('th');th.textContent=title;titles.append(th);}
 head.append(titles);const body=document.createElement('tbody');
 for(const [label,items] of groups){
  const row=document.createElement('tr'),name=document.createElement('th');name.textContent=label;row.append(name);
  for(let inv=0;inv<4;inv++){
   const cell=document.createElement('td'),item=items[inv];row.append(cell);
   if(!item)continue;
   const button=document.createElement('button');button.className='item-choice';button.append(itemLabel(item));
   const rate=document.createElement('small'),accuracy=historyStats(history[item.id]).accuracy;
   rate.textContent=accuracy===null?'—':percent(accuracy);button.append(rate);
   button.setAttribute('aria-label',[label,item.freeOctaves?'':inversionNames[inv],rate.textContent].filter(Boolean).join(' '));
   button.setAttribute('aria-pressed',String(freeSelection.has(item.id)));
   button.addEventListener('click',()=>{
    if(freeSelection.has(item.id))freeSelection.delete(item.id);else freeSelection.add(item.id);
    button.setAttribute('aria-pressed',String(freeSelection.has(item.id)));updateFreeNext();
   });
   cell.append(button);if(item.freeOctaves){cell.colSpan=4;break;}
  }
  body.append(row);
 }
 $('free-table').replaceChildren(head,body);updateFreeNext();
}
function updateFreeNext(){
 $('free-next').disabled=freeSelection.size<4;
 $('free-next').textContent=freeSelection.size<4?`训练（${freeSelection.size}/4）`:`训练（${freeSelection.size}）`;
}
function setupPracticeControls(){
 $('free-quality').replaceChildren(option('','全部和弦'),...qualities.map((q,i)=>option(i,q.name)));
 $('free-inv').replaceChildren(option('','全部转位'),...inversionNames.map((name,i)=>option(i,name)));
 $('free-action').addEventListener('click',()=>{
  for(const item of catalogue)history[item.id]=countsFor(item.id);
  renderFree();$('free-dialog').showModal();
 });
 $('free-filter').addEventListener('input',renderFree);
 for(const id of ['free-quality','free-inv'])$(id).addEventListener('change',renderFree);
 $('free-lowest').addEventListener('click',()=>{
  const ranked=filteredItems().map(i=>({i,...historyStats(history[i.id])})).filter(row=>row.total);
  ranked.sort((a,b)=>a.accuracy-b.accuracy||b.total-a.total);
  freeSelection.clear();ranked.slice(0,12).forEach(({i})=>freeSelection.add(i.id));renderFree();
 });
 $('free-next').addEventListener('click',()=>{
  if(freeSelection.size<4)return;
  $('free-dialog').close();startLearning({name:'自由训练',items:catalogue.filter(i=>freeSelection.has(i.id))});
 });
 $('free-close').addEventListener('click',()=>$('free-dialog').close());
 $('midi-close').addEventListener('click',()=>$('midi-dialog').close());
 $('system-close').addEventListener('click',()=>$('system-dialog').close());
 $('system-midi').addEventListener('click',openMidi);
 $('reset-records').addEventListener('click',()=>$('reset-dialog').showModal());
 $('reset-cancel').addEventListener('click',()=>$('reset-dialog').close());
 $('reset-confirm').addEventListener('click',()=>{
  generation='routes-'+Date.now();save(recordsVersionKey,generation);
  try{clearStoredRecords();}catch{/* Browser storage may be unavailable. Reset in-memory progress too. */}
  for(const cache of [results,history])for(const key of Object.keys(cache))delete cache[key];
  freeSelection.clear();selectedRoute=null;selection=null;sessionStage=null;
  stageIndex=currentProgress(results);mode='challenge';
  $('reset-dialog').close();$('system-dialog').close();reset();focusCurrentStage();
 });
 $('tips-toggle').addEventListener('click',()=>{$('tips-text').value=tips.join('\n');$('tips-dialog').showModal();});
 $('tips-close').addEventListener('click',()=>$('tips-dialog').close());
 $('tips-save').addEventListener('click',()=>{
  tips=$('tips-text').value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
  save('voicing-tips',tips);$('tips-dialog').close();
 });
 $('practice-start').addEventListener('click',()=>{
  $('settings-dialog').close();startMode('practice');
 });
}
globalThis.addEventListener?.('storage',event=>{
 if(event.key===recordsVersionKey&&event.newValue!==JSON.stringify(generation))location.reload();
});
setupPracticeControls();reset();focusCurrentStage();requestAnimationFrame(render);
