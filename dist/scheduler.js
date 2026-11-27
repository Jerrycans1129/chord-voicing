import {trainingItems,positions,shuffle} from './theory.js';
import {historyStats,grades} from './scoring.js';

export class Scheduler{
 constructor(stage,{history=null,rng=Math.random}={}){
  this.items=stage.items??trainingItems(stage);
  this.history=new Map(this.items.map(item=>[item.id,history?historyStats(history[item.id]).weakness:0]));
  this.levels=new Map();
  this.positions=new Map(this.items.map(item=>[item.id,positions(item.pc,item.q,item.inv)]));
  this.rng=rng;this.slots=[];this.bag=[];this.rootBags=new Map();this.lastSeen=new Map();this.index=0;this.lastRoot=null;
 }
 record(id,score){
  if(!this.history.has(id)||!grades.includes(score))return;
  this.levels.set(id,((this.levels.get(id)??0)+1-score)/2);
 }
 weight(id){return this.history.get(id)+2*(this.levels.get(id)??0);}
 next(){
  if(!this.slots.length)this.slots=shuffle([false,false,false,false,false,false,false,true,true,true],this.rng);
  const reviewSlot=this.slots.pop();
  const eligible=item=>this.positions.get(item.id).some(root=>root!==this.lastRoot);
  let item,source='balanced';
  if(reviewSlot){
   const candidates=this.items.filter(i=>this.weight(i.id)>0&&this.index-(this.lastSeen.get(i.id)??-Infinity)>=4&&eligible(i));
   const total=candidates.reduce((sum,i)=>sum+this.weight(i.id),0);
   if(total){let ticket=this.rng()*total;item=candidates.find(i=>(ticket-=this.weight(i.id))<0);source='review';}
  }
  if(!item){
   if(!this.bag.length)this.bag=shuffle([...this.items],this.rng);
   let at=this.bag.findIndex(i=>eligible(i)&&this.lastSeen.get(i.id)!==this.index-1);
   if(at<0)at=this.bag.findIndex(eligible);
   if(at<0)at=Math.max(0,this.bag.findIndex(i=>this.lastSeen.get(i.id)!==this.index-1));
   [item]=this.bag.splice(at,1);
  }
  const legal=this.positions.get(item.id);
  let roots=this.rootBags.get(item.id);
  if(!roots?.length){roots=shuffle([...legal],this.rng);this.rootBags.set(item.id,roots);}
  const at=roots.findIndex(root=>root!==this.lastRoot);
  const root=at>=0?roots.splice(at,1)[0]:legal.find(root=>root!==this.lastRoot)??roots.pop();
  this.lastRoot=root;this.lastSeen.set(item.id,this.index++);
  return {...item,root,source,reviewSlot};
 }
}
