export const names=[['C'],['C♯','D♭'],['D'],['D♯','E♭'],['E'],['F'],['F♯','G♭'],['G'],['G♯','A♭'],['A'],['A♯','B♭'],['B']];
export const qualities=[{name:'大三和弦',suffix:'',intervals:[0,4,7]},{name:'小三和弦',suffix:'m',intervals:[0,3,7]},{name:'sus4 和弦',suffix:'sus4',intervals:[0,5,7]}];
export const inversions=['原位','第一转位','第二转位'];
export const stages=[
 {id:'notes-two',kind:'note',chapter:'单音基础',name:'两个黑键',detail:'C♯ / D♭ · D♯ / E♭',pcs:[1,3]},
 {id:'notes-three',kind:'note',chapter:'单音基础',name:'三个黑键',detail:'F♯ / G♭ · G♯ / A♭ · A♯ / B♭',pcs:[6,8,10]},
 {id:'notes-black',kind:'note',chapter:'单音基础',name:'五个黑键混合',pcs:[1,3,6,8,10],mixed:true},
 {id:'notes-white',kind:'note',chapter:'单音基础',name:'七个白键混合',pcs:[0,2,4,5,7,9,11],mixed:true},
 {id:'notes-all',kind:'note',chapter:'单音基础',name:'黑白键综合',pcs:Array.from({length:12},(_,i)=>i),mixed:true}
];
const learned=[];
for(let q=0;q<3;q++){
 for(const inv of [1,2,0]){
  learned.push({q,inv});
  stages.push({id:`chord-${q}-${inv}`,chapter:qualities[q].name,name:`${qualities[q].name} · ${inversions[inv]}`,combos:[{q,inv}]});
  if(q>0||inv!==1)stages.push({id:`mix-${q}-${inv}`,chapter:qualities[q].name,name:q===0?(inv===2?'大三 · 两种转位混合':'大三 · 全部转位'):q===2&&inv===0?'全部和弦综合':`累计综合 · ${q===1?'加入小三':'加入 sus4'}${inversions[inv]}`,combos:learned.map(c=>({...c})),mixed:true});
 }
}
export function notes(root,q,inv){const [r,t,f]=qualities[q].intervals;return inv===0?[root+r,root+t,root+f]:inv===1?[root+t-12,root+f-12,root]:[root+f-12,root,root+t];}
export function positions(pc,q,inv){return Array.from({length:37},(_,i)=>i+48).filter(root=>root%12===pc&&(q===undefined||notes(root,q,inv).every(n=>n>=48&&n<=84)));}
export function shuffle(items,rng=Math.random){for(let i=items.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
export function trainingItems(stage){
 const items=[];
 for(const pc of stage.pcs??names.map((_,i)=>i))for(const name of names[pc]){
  if(stage.kind==='note')items.push({id:`note:${name}`,kind:'note',pc,name,label:name});
  else for(const {q,inv} of stage.combos)items.push({id:`chord:${name}:${q}:${inv}`,kind:'chord',pc,name,q,inv,label:name+qualities[q].suffix});
 }
 return items;
}
// Old index-based settings are migrated once; old coverage counters are not
// interpreted as completions of the new, differently scoped curriculum.
export function initialStage(savedId,legacyIndex,blackOnly=false){
 const found=stages.findIndex(s=>s.id===savedId);if(found>=0)return found;
 if(legacyIndex===-1)return blackOnly?2:4;
 const mapping=[5,6,8,9,10,12,14,15,15,16,18,20,21,21];
 return Number.isInteger(legacyIndex)&&mapping[legacyIndex]!==undefined?mapping[legacyIndex]:0;
}
