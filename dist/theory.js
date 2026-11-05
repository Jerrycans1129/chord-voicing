export const names=[['C'],['C♯','D♭'],['D'],['D♯','E♭'],['E'],['F'],['F♯','G♭'],['G'],['G♯','A♭'],['A'],['A♯','B♭'],['B']];
// Stable quality indices preserve existing item IDs and weakness records.
export const qualities=[
 {name:'大三',suffix:'',intervals:[0,4,7]},
 {name:'小三',suffix:'m',intervals:[0,3,7]},
 {name:'挂四',suffix:'sus4',intervals:[0,5,7]},
 {name:'挂二',suffix:'sus2',intervals:[0,2,7]},
 {name:'属七',suffix:'7',intervals:[0,4,7,10]},
 {name:'小七',suffix:'m7',intervals:[0,3,7,10]},
 {name:'大七',suffix:'maj7',intervals:[0,4,7,11]},
 {name:'属七挂四',suffix:'7sus4',intervals:[0,5,7,10]},
 {name:'加九',suffix:'add9',intervals:[0,2,4,7]},
 {name:'小加九',suffix:'m(add9)',intervals:[0,2,3,7]},
 {name:'大六',suffix:'6',intervals:[0,4,7,9]},
 {name:'属九',suffix:'9',intervals:[0,2,4,7,10],freeOctaves:true},
 {name:'小九',suffix:'m9',intervals:[0,2,3,7,10],freeOctaves:true},
 {name:'大九',suffix:'maj9',intervals:[0,2,4,7,11],freeOctaves:true},
 {name:'减三',suffix:'dim',intervals:[0,3,6]},
 {name:'半减七',suffix:'m7♭5',intervals:[0,3,6,10]},
 {name:'减七',suffix:'dim7',intervals:[0,3,6,9]},
 {name:'增三',suffix:'aug',intervals:[0,4,8]},
 {name:'小六',suffix:'m6',intervals:[0,3,7,9]},
 {name:'小大七',suffix:'m(maj7)',intervals:[0,3,7,11]}
];
export const inversions=['原位','根音在右','根音居中','根音左二'];
export function voicingLabel(q,inv){return inv===0?'原位':inv===1?'根音在右':qualities[q].intervals.length===3?'根音居中':inv===2?'根音右二':'根音左二';}
const noteChildren=[
 {id:'notes-two',kind:'note',name:'2个黑键',pcs:[1,3]},
 {id:'notes-three',kind:'note',name:'3个黑键',pcs:[6,8,10]},
 {id:'notes-black',kind:'note',name:'5个黑键',pcs:[1,3,6,8,10]},
 {id:'notes-white',kind:'note',name:'7个白键',pcs:[0,2,4,5,7,9,11]}
];
const chordChildren=qualities.map((quality,q)=>{
 if(quality.freeOctaves)return {id:`quality-${q}`,name:quality.name,combos:[{q,inv:0}]};
 const order=Array.from({length:quality.intervals.length-1},(_,i)=>i+1).concat(0);
 const children=order.map(inv=>({id:`chord-${q}-${inv}`,name:voicingLabel(q,inv),combos:[{q,inv}]}));
 return {id:`quality-${q}`,name:quality.name,children,combos:children.flatMap(s=>s.combos),mixed:true};
});
const coreTriads=[0,1],coreSevenths=[4,5,6],colors=[2,3,8,7,9,10];
const core=[...coreTriads,...coreSevenths];
const chordNode=q=>({...chordChildren[q],name:qualities[q].name+'和弦'});
function mixedLevel(level,title,qs){
 return {id:level===2?'level-2':`level-${level}-v2`,name:`Level-${level}\n${title}`,comprehensive:true,
  combos:qs.flatMap(q=>chordChildren[q].combos)};
}
const noteMix={id:'notes-all',name:'Level-1\n全部12个键',kind:'note',pcs:Array.from({length:12},(_,i)=>i),comprehensive:true};
export const curriculum=[
 {id:'project-notes',name:'单音',project:true,children:[...noteChildren,noteMix]},
 {id:'project-core',name:'核心和弦',project:true,children:[
  ...coreTriads.map(chordNode),mixedLevel(2,'核心三和弦',coreTriads),
  ...coreSevenths.map(chordNode),mixedLevel(3,'核心七和弦',coreSevenths)]},
 {id:'project-colors',name:'常用色彩和弦',project:true,children:[...colors.map(chordNode),mixedLevel(4,'色彩和弦',colors)]},
 {id:'project-mixed',name:'综合训练',project:true,children:[mixedLevel(5,'核心和弦综合',core),mixedLevel(6,'基础和弦综合',[...core,...colors])]},
 {id:'project-extended',name:'扩展和弦',project:true,children:[11,12,13,14,15,16,17,18,19].map(chordNode)}
];
// Projects are navigation only. Stable quality indices keep legacy item identities.
export const stages=[];
function visit(node,parent=null,project=node.id){node.parent=parent;node.projectId=project;for(const child of node.children??[])visit(child,node.id,project);if(!node.project)stages.push(node);}
curriculum.forEach(node=>visit(node));
export function selectable(node,results){return !!node&&!node.project;}
export function currentProgress(results){const index=stages.findIndex(node=>selectable(node,results)&&results[node.id]?.best.stars!==3);return index<0?stages.length-1:index;}
export function migrateResults(saved){const migrated={...saved};if(!migrated['quality-0']&&saved?.['mix-0-0'])migrated['quality-0']=saved['mix-0-0'];return migrated;}
// inv rotates the sorted, close-position pitch classes; root remains the anchor.
export function notes(root,q,inv){const intervals=qualities[q].intervals;return inv===0?intervals.map(n=>root+n):intervals.slice(inv).map(n=>root+n-12).concat(intervals.slice(0,inv).map(n=>root+n));}
export function positions(pc,q,inv){if(qualities[q]?.freeOctaves)return [48+pc];return Array.from({length:37},(_,i)=>i+48).filter(root=>root%12===pc&&(q===undefined||notes(root,q,inv).every(n=>n>=48&&n<=84)));}
export function shuffle(items,rng=Math.random){for(let i=items.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
export function trainingItems(stage){
 const items=[];
 for(const pc of stage.pcs??names.map((_,i)=>i))for(const name of names[pc]){
  if(stage.kind==='note')items.push({id:`note:${name}`,kind:'note',pc,name,label:name});
  else for(const {q,inv} of stage.combos)items.push({id:`chord:${name}:${q}:${inv}`,kind:'chord',pc,name,q,inv,freeOctaves:!!qualities[q].freeOctaves,label:name+qualities[q].suffix});
 }
 return items;
}
