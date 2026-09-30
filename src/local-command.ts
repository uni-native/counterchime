import {toolAction, type SessionState} from './session';
import {zero} from './scenarios';
export function localCommand(state:SessionState,text:string){
 const command=text.toLowerCase().trim().replace(/[.!]$/,'');
 if(command==='test'||command==='test economy'||command==='test the rules') return toolAction(state,'analyze_economy',{});
 if(command==='undo'||command==='undo that change') return toolAction(state,'undo_last_edit',{base_revision:state.revision});
 const numbers:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,first:1,second:2,third:3,fourth:4,fifth:5,sixth:6};
 const match=command.match(/^(?:change|set) (?:the )?(?:(first|second|third|fourth|fifth|sixth) rule|rule ([1-6])) (?:output )?to (one|two|three|four|five|six|seven|eight|nine|[1-9]) (wood|stone|stars)$/);
 if(!match) throw new Error('The local parser supports “test”, “undo”, or “change the second rule to two wood”. For other edits, use the rule controls or live voice.');
 const index=match[1]?numbers[match[1]]:Number(match[2]);const rule=state.scenario.rules[index-1];if(!rule) throw new Error(`Rule ${index} does not exist.`);
 const amount=numbers[match[3]]||Number(match[3]);
 return toolAction(state,'upsert_rule',{index,name:rule.name,input:rule.input,output:{...zero(),[match[4]]:amount},base_revision:state.revision});
}
