import {trainingItems,positions,shuffle} from './theory.js';
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
  this.levels=levels;this.rng=rng;this.bag=[];this.slots=[];this.rootBags=new Map();this.lastSeen=new Map();this.index=0;
 }
 record(id,result){
  if(!this.byId.has(id)||!['wrong','correct'].includes(result))return false;
  const old=this.levels[id]||0,newLevel=Math.max(0,Math.min(3,old+(result==='wrong'?1:-1)));
  if(newLevel===old)return false;
  if(newLevel)this.levels[id]=newLevel;else delete this.levels[id];return true;
 }
 next(){
  if(!this.slots.length)this.slots=shuffle([false,false,false,false,false,false,false,true,true,true],this.rng);
  const reviewSlot=this.slots.pop();let item,source='balanced';
  if(reviewSlot){
   const candidates=this.items.filter(i=>reviewWeights[this.levels[i.id]||0]>0&&this.index-(this.lastSeen.get(i.id)??-Infinity)>=4);
   const total=candidates.reduce((n,i)=>n+reviewWeights[this.levels[i.id]],0);
   if(total){let ticket=this.rng()*total;item=candidates.find(i=>(ticket-=reviewWeights[this.levels[i.id]])<0);source='review';}
  }
  if(!item){
   if(!this.bag.length)this.bag=shuffle([...this.items],this.rng);
   // Avoid an immediate duplicate at bag boundaries when another item is available.
   let at=this.bag.findIndex(i=>this.lastSeen.get(i.id)!==this.index-1);if(at<0)at=0;
   [item]=this.bag.splice(at,1);
  }
  let roots=this.rootBags.get(item.id);
  if(!roots?.length){roots=shuffle(positions(item.pc,item.q,item.inv),this.rng);this.rootBags.set(item.id,roots);}
  this.lastSeen.set(item.id,this.index++);
  return {...item,root:roots.pop(),source,reviewSlot};
 }
}
