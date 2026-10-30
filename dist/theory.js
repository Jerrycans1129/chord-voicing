export const names=['C','D♭','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
export const qualities=[{name:'大三和弦',suffix:'',intervals:[0,4,7]},{name:'小三和弦',suffix:'m',intervals:[0,3,7]},{name:'sus4 和弦',suffix:'sus4',intervals:[0,5,7]}];
export const inversions=['原位','第一转位','第二转位'];
export const stages=[];
for(let q=0;q<3;q++){
  for(const inv of [1,2,0]) stages.push({name:`${qualities[q].name} · ${inversions[inv]}`,qs:[q],invs:[inv]});
  stages.push({name:`${qualities[q].name} · 转位混合`,qs:[q],invs:[0,1,2]});
  if(q>0)stages.push({name:q===1?'综合 · 大三 + 小三':'综合 · 大三 + 小三 + sus4',qs:Array.from({length:q+1},(_,i)=>i),invs:[0,1,2]});
}
export function notes(root,q,inv){const [r,t,f]=qualities[q].intervals;return inv===0?[root+r,root+t,root+f]:inv===1?[root+t-12,root+f-12,root]:[root+f-12,root,root+t];}
export function positions(pc,q,inv){return Array.from({length:37},(_,i)=>i+48).filter(root=>root%12===pc&&notes(root,q,inv).every(n=>n>=48&&n<=84));}
export function shuffle(items,rng=Math.random){for(let i=items.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
export function makeRound(stage,cycle=0,rng=Math.random){
  const cards=[];
  for(let pc=0;pc<12;pc++)for(let i=0;i<3;i++){
    const inv=stage.invs[i%stage.invs.length];
    const q=stage.qs[(pc+i+cycle)%stage.qs.length];
    const roots=positions(pc,q,inv);
    cards.push({pc,q,inv,root:roots[Math.floor(rng()*roots.length)],label:names[pc]+qualities[q].suffix});
  }
  return shuffle(cards,rng);
}
