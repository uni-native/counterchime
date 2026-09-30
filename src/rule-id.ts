import type {Rule} from './engine';
/** Revisions restart on import/reload; existing rule IDs remain stable. */
export function freshRuleId(rules:readonly Rule[],revision:number,index:number):string {
 const occupied=new Set(rules.map(rule=>rule.id));const stem=`trade-${revision}-${index}`;
 let id=stem;let suffix=2;while(occupied.has(id))id=`${stem}-${suffix++}`;
 return id;
}
