import {trainingItems,positions,shuffle,supportsPractice} from './theory.js';
export const reviewWeights=[0,1,3,7];
export function cleanLevels(value){
 const result=Object.create(null);
 if(value&&typeof value==='object'&&!Array.isArray(value))for(const [id,level] of Object.entries(value)){
  if(/^(note|chord):/.test(id)&&Number.isInteger(level)&&level>0&&level<=3)result[id]=level;
 }
 return result;
}
export class Scheduler{
 constructor(stage,{levels=Object.create(null),rng=Math.random}={}){
  this.items=trainingItems(stage);this.byId=new Map(this.items.map(i=>[i.id,i]));
  this.pools=stage.pools?stage.pools.map(combos=>trainingItems({...stage,combos})):[this.items];
  this.bags=this.pools.map(()=>[]);this.poolSlots=[];
  this.levels=levels;this.rng=rng;this.slots=[];this.rootBags=new Map();this.lastSeen=new Map();this.index=0;
 }
 record(id,result){
  if(!this.byId.has(id)||!['wrong','correct'].includes(result))return false;
  const old=this.levels[id]||0,newLevel=Math.max(0,Math.min(3,old+(result==='wrong'?1:-1)));
  if(newLevel===old)return false;
  if(newLevel)this.levels[id]=newLevel;else delete this.levels[id];return true;
 }
 next(){
  if(!this.slots.length)this.slots=shuffle([false,false,false,false,false,false,false,true,true,true],this.rng);
  if(!this.poolSlots.length)this.poolSlots=this.pools.length===2?shuffle([0,0,0,0,0,1,1,1,1,1],this.rng):Array(10).fill(0);
  const poolIndex=this.poolSlots.pop(),pool=this.pools[poolIndex];
  const reviewSlot=this.slots.pop();let item,source='balanced';
  if(reviewSlot){
   const candidates=pool.filter(i=>reviewWeights[this.levels[i.id]||0]>0&&this.index-(this.lastSeen.get(i.id)??-Infinity)>=4);
   const total=candidates.reduce((n,i)=>n+reviewWeights[this.levels[i.id]],0);
   if(total){let ticket=this.rng()*total;item=candidates.find(i=>(ticket-=reviewWeights[this.levels[i.id]])<0);source='review';}
  }
  if(!item){
   if(!this.bags[poolIndex].length)this.bags[poolIndex]=shuffle([...pool],this.rng);
   const bag=this.bags[poolIndex];
   // Avoid an immediate duplicate at bag boundaries when another item is available.
   let at=bag.findIndex(i=>this.lastSeen.get(i.id)!==this.index-1);if(at<0)at=0;
   [item]=bag.splice(at,1);
  }
  let roots=this.rootBags.get(item.id);
  if(!roots?.length){roots=shuffle(positions(item.pc,item.q,item.inv),this.rng);this.rootBags.set(item.id,roots);}
  this.lastSeen.set(item.id,this.index++);
  return {...item,root:roots.pop(),source,reviewSlot};
 }
}

// Practice repeats the same root cycle, with no weakness or spelling weighting.
export class PracticeScheduler{
 constructor(stage,{rng=Math.random}={}){
  if(!supportsPractice(stage))throw new Error('Practice requires a single chord quality');
  this.items=trainingItems(stage);this.rng=rng;this.index=0;this.startPc=Math.floor(rng()*12);
 }
 next(){
  const pc=(this.startPc+this.index*5)%12;
  const spelling=['C','D♭','D','E♭','E','F','G♭','G','A♭','A','B♭','B'][pc];
  const candidates=this.items.filter(item=>item.pc===pc&&item.name===spelling);
  const item=candidates[Math.floor(this.rng()*candidates.length)];
  const roots=positions(pc,item.q,item.inv);
  this.index=(this.index+1)%12;
  return {...item,root:roots[Math.floor(this.rng()*roots.length)]};
 }
}
