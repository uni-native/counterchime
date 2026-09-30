import type {Inventory, Scenario} from './engine';
export const RESOURCES = ['wood','stone','stars'] as const;
export const zero=():Inventory=>({wood:0,stone:0,stars:0});
export const inventory=(wood=0,stone=0,stars=0):Inventory=>({wood,stone,stars});
export const EXAMPLES: {id:string;label:string;description:string;scenario:Scenario}[] = [
 {id:'timber',label:'The timber exchange',description:'A two-trade loop creates one extra wood.',scenario:{title:'The timber exchange',initial:inventory(2),rules:[{id:'trade-1',name:'Quarry trade',input:inventory(2),output:inventory(0,1)},{id:'trade-2',name:'Timber trade',input:inventory(0,1),output:inventory(3)}]}},
 {id:'neutral',label:'A fair exchange',description:'Returning to the same inventory is not growth.',scenario:{title:'A fair exchange',initial:inventory(2),rules:[{id:'trade-1',name:'Quarry trade',input:inventory(2),output:inventory(0,1)},{id:'trade-2',name:'Timber trade',input:inventory(0,1),output:inventory(2)}]}},
 {id:'locked',label:'The locked star loop',description:'A profitable recipe is unreachable without its starting star.',scenario:{title:'The locked star loop',initial:inventory(2),rules:[{id:'trade-1',name:'Star-gated trade',input:inventory(1,0,1),output:inventory(0,1,1)},{id:'trade-2',name:'Timber trade',input:inventory(0,1),output:inventory(2)}]}},
 {id:'three',label:'Three-way arbitrage',description:'The full loop crosses three resources.',scenario:{title:'Three-way arbitrage',initial:inventory(2),rules:[{id:'trade-1',name:'Quarry trade',input:inventory(2),output:inventory(0,1)},{id:'trade-2',name:'Star trade',input:inventory(0,1),output:inventory(0,0,1)},{id:'trade-3',name:'Timber trade',input:inventory(0,0,1),output:inventory(3)}]}},
];
export const formatInventory=(value:Inventory)=>RESOURCES.filter(r=>value[r]>0).map(r=>`${value[r]} ${r}`).join(' + ') || 'nothing';
export const copyScenario=(value:Scenario):Scenario=>structuredClone(value);
