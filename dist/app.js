import {stages,makeRound,notes} from './theory.js';
const $=id=>document.getElementById(id);
const read=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};
// Keep existing chord stage indices and saved progress stable.
let stageIndex=Number(read('voicing-stage',-1));if(!Number.isInteger(stageIndex)||(stageIndex!==-1&&!stages[stageIndex]))stageIndex=-1;
let blackOnly=read('voicing-note-black-only',false)===true;
const batchSize=()=>stageIndex===-1&&blackOnly?15:36;
let cycles=read('voicing-cycles',{});if(!cycles||typeof cycles!=='object'||Array.isArray(cycles))cycles={};
let bpm=Number(read('voicing-bpm',60));if(!Number.isFinite(bpm))bpm=60;
bpm=Math.max(40,Math.min(120,Math.round(bpm/10)*10));
let cards=[],elements=[],elapsed=0,previous=0,running=false,started=false,finished=false;
let sessionSeconds=0,baseCycle=0,completedBatches=0;
const MAX_SECONDS=30*60;
// Ignore all note attacks within 180ms on either side of a label handoff.
const MIDI_GRACE_SECONDS=.18;
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
 $('keyboard').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);
 $('keyboard-frost').hidden=phoneLayout||!keyboardBlurOn;
 $('keyboard-frost').dataset.obscured=String(running&&keyboardBlurOn&&!phoneLayout);
 $('keyboard-blur-setting').hidden=phoneLayout;
 $('keyboard-blur').checked=keyboardBlurOn;
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
 $('midi-notes').textContent=held.size?`按下 ${held.size} 键${outside?` · ${outside} 键超出 C3–C6`:''}`:'等待演奏 · 蓝色为输入，绿点为答案';
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
 if(command===0x90&&velocity>0){keys.add(note);judgeMidi(note);}
 else if(command===0x80||command===0x90)keys.delete(note);
 else if(note===120||note===123||(note>=124&&note<=127))keys.clear();
 else return;
 paintMidi();
}
function paintFeedback(index){
 const card=cards[index],el=elements[index];
 el.dataset.feedback=card.feedback||'waiting';
 // Use training progress so pausing freezes the fade and tempo changes stay aligned.
 el.style.opacity=card.feedback==='wrong'?'1'
  :String(Math.max(0,Math.min(1,index+3-elapsed)));
}
function judgeMidi(note){
 if(!running)return;
 // MIDI can arrive between animation frames; judge against the current clock.
 advance(performance.now());
 if(!running)return;
 while(elapsed+2>=cards.length)appendBatch();
 const index=Math.floor(elapsed-2),phase=elapsed-2-index;
 const grace=MIDI_GRACE_SECONDS*bpm/240;
 if(index<0||phase<=grace||1-phase<=grace)return;
 const card=cards[index];
 if(card.feedback==='wrong')return;
 const pitches=card.kind==='note'?[card.root]:notes(card.root,card.q,card.inv);
 if(!pitches.includes(note))card.feedback='wrong';
 else card.feedback='correct';
 paintFeedback(index);
}
function syncMidiInputs(){
 const connected=new Map([...midiAccess.inputs.values()].filter(input=>input.state!=='disconnected').map(input=>[input.id,input]));
 for(const [id,input] of midiInputs){
  if(connected.get(id)!==input){input.onmidimessage=null;midiInputs.delete(id);midiHeld.delete(id);}
 }
 for(const [id,input] of connected){
  if(midiInputs.has(id))continue;
  midiInputs.set(id,input);input.onmidimessage=event=>receiveMidi(id,event);
 }
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
$('midi-clear').addEventListener('click',event=>{event.stopPropagation();clearMidi();});
$('midi-status').textContent=midiAvailability()||'尚未启用 · 点击连接 MIDI 并允许浏览器访问';
paintMidi();
const noteOption=document.createElement('option');noteOption.value=-1;noteOption.textContent='00  音名识别';$('stage').append(noteOption);
stages.forEach((s,i)=>{const option=document.createElement('option');option.value=i;option.textContent=`${String(i+1).padStart(2,'0')}  ${s.name}`;$('stage').append(option);});
$('stage').value=stageIndex;$('speed').value=bpm;$('speed-value').textContent=`${bpm} BPM`;
function hidePauseControls(){
 $('settings-toggle').hidden=true;
 for(const dot of answerDots.values())dot.hidden=true;
}
function showAnswer(){
 // Keep the answer for the landed chord until the next one lands. During
 // the opening lead-in, reveal the first approaching chord.
 const card=cards[Math.max(0,Math.floor(elapsed-2))];
 const pitches=card?(card.kind==='note'?[card.root]:notes(card.root,card.q,card.inv)):[];
 for(const [midi,dot] of answerDots)dot.hidden=!pitches.includes(midi);
}
function openSettings(){
 if(running||!started||finished)return;
 hidePauseControls();
 showOverlay('训练设置','进度已保留 · 切换阶段将重新开始一轮','继续训练 →');
}
function showOverlay(title,description,button){updateKeyboardBlur();hidePauseControls();$('overlay').hidden=false;$('overlay').querySelector('h1').textContent=title;$('status').textContent=description;$('overlay-action').textContent=button;}
function appendBatch(){
 const batch=makeRound(stageIndex===-1?{kind:'note',blackOnly}:stages[stageIndex],baseCycle+cards.length/batchSize());
 for(const card of batch){
  const el=document.createElement('div');el.className='card';el.dataset.inv=card.inv;
  el.style.left=`${centers.get(card.root)*100}%`;el.hidden=true;
  const chord=document.createElement('span');chord.className='chord';chord.textContent=card.label;
  el.append(chord);$('falling').append(el);elements.push(el);cards.push(card);
 }
}
function reset(){
 releaseScreenLock();stopMetronome();
 running=false;started=false;finished=false;elapsed=0;previous=0;sessionSeconds=0;completedBatches=0;
 baseCycle=Number.isSafeInteger(cycles[stageIndex])?cycles[stageIndex]:0;
 cards=[];elements=[];$('falling').replaceChildren();appendBatch();updateTimer();
 $('stage-number').textContent=stageIndex===-1?'前置关卡':`${stageIndex+1} / 14`;
 $('note-range').hidden=stageIndex!==-1;
 $('note-all').checked=!blackOnly;$('note-black').checked=blackOnly;
 showOverlay('准备训练','标签平滑下落，触及琴键时弹奏，背景竖线随拍亮起。轻点屏幕暂停并查看答案，再点继续；暂停后可打开右上角设置。最长 30 分钟。','开始训练 →');
}
function pause(){
 if(!running)return;advance(performance.now());if(finished)return;
 running=false;updateKeyboardBlur();releaseScreenLock();stopMetronome();
 while(elapsed+2>=cards.length)appendBatch();
 $('overlay').hidden=true;$('settings-toggle').hidden=false;showAnswer();
}
function play(){if(running){pause();return;}if(finished)reset();hidePauseControls();running=true;updateKeyboardBlur();started=true;previous=performance.now();unlockAudio();void keepScreenAwake();$('overlay').hidden=true;$('status').textContent='训练中 · 标记到达琴键上沿时弹奏';}
function complete(){releaseScreenLock();stopMetronome();running=false;finished=true;elements.forEach(el=>{el.hidden=true;});showOverlay('本轮已完成','本次训练已持续 30:00。可以重新开始，或选择其他训练阶段。','再练一轮 →');}
function advance(now){
 if(running){const dt=Math.min(Math.max(0,(now-previous)/1000),MAX_SECONDS-sessionSeconds);sessionSeconds+=dt;elapsed+=dt*bpm/240;updateTimer();
  const batches=Math.floor(Math.max(0,Math.floor(elapsed-2)+1)/batchSize());
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
   if(!el.hidden)paintFeedback(i);
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
$('keyboard-blur').addEventListener('change',()=>{
 keyboardBlurOn=$('keyboard-blur').checked;save('voicing-keyboard-blur',keyboardBlurOn);updateKeyboardBlur();
});
$('metronome').addEventListener('pointerup',e=>e.stopPropagation());
$('metronome').addEventListener('click',e=>{
 e.stopPropagation();metronomeOn=!metronomeOn;save('voicing-metronome',metronomeOn);
 stopMetronome();if(metronomeOn)unlockAudio();updateMetronome();
});
$('overlay-action').addEventListener('click',e=>{e.stopPropagation();play();});$('restart').addEventListener('click',e=>{e.stopPropagation();reset();play();});
$('settings-toggle').addEventListener('click',e=>{e.stopPropagation();openSettings();});
$('overlay').addEventListener('click',e=>e.stopPropagation());
// One click path for mouse and touch avoids a pointerup + click double toggle.
document.addEventListener('click',()=>{
 if(running)pause();else if(started&&!finished&&$('overlay').hidden)play();
});
$('stage').addEventListener('change',()=>{stageIndex=Number($('stage').value);save('voicing-stage',stageIndex);reset();});
for(const id of ['note-all','note-black'])$(id).addEventListener('change',()=>{
 if(!$(id).checked)return;
 blackOnly=id==='note-black';save('voicing-note-black-only',blackOnly);reset();
});
$('speed').addEventListener('change',()=>{advance(performance.now());stopMetronome();bpm=Number($('speed').value);$('speed-value').textContent=`${bpm} BPM`;save('voicing-bpm',bpm);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();clearMidi();}});
const portrait=matchMedia('(orientation: portrait) and (max-width: 1100px) and (any-pointer: coarse)');portrait.addEventListener('change',e=>{if(e.matches)pause();});
document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();play();}});
reset();requestAnimationFrame(render);
