import { expect, test } from "bun:test";
import { createA2CardActionHandler, routeReportCardActions } from "../src/a2-card-actions.ts";
import { A2ReportService } from "../src/a2-report.ts";
const rows=[{date:"2026-11-14",A2:100000,other_A2:200000},{date:"2026-11-15",A2:110000,other_A2:200000},{date:"2026-11-16",A2:999999,other_A2:999999}];
const action=(selected="samo")=>({action:{value:{action:"a2_switch",game_codes:["w","rok","samo","pgame"],selected_game:selected,report_date:"2026-11-15",expires_at:new Date(Date.now()+86400000).toISOString()}},context:{open_message_id:"forwarded-message"}});
function callbacks(value:any):any[]{if(Array.isArray(value))return value.flatMap(callbacks);if(!value||typeof value!=="object")return[];return(value.type==="callback"?[value.value]:[]).concat(Object.values(value).flatMap(callbacks));}
test("总览切单游戏仍保留四游戏和返回总览，日期固定且默认转发可交互",async()=>{
 let reads=0;const service=new A2ReportService({readDaily:async()=>{reads++;return rows;}});
 const handler=createA2CardActionHandler(service);
 const response=await handler(action());expect(response.card).toBeDefined();const card=response.card!.data;
 expect((card.header as any).title.content).toContain("万龙觉醒");expect((card.config as any).enable_forward).toBe(true);expect((card.config as any).enable_forward_interaction).toBe(true);
 const buttons=callbacks(card);expect(buttons.map(v=>v.selected_game)).toEqual(["overview","w","rok","samo","pgame"]);
 expect(buttons.every(v=>v.report_date==="2026-11-15"&&v.game_codes.length===4)).toBe(true);
 expect(JSON.stringify(card)).not.toContain("100.00万");expect(reads).toBe(1);
 const overview=await handler(action("overview"));expect((overview.card!.data.header as any).title.content).toContain("概览");expect(reads).toBe(4);
});
test("拒绝越界游戏、过期卡片与无效回调",async()=>{
 let reads=0;const handler=createA2CardActionHandler({view:async()=>{reads++;return {cards:[],reports:[],dashboardUrl:"",viewState:{} as never};}} as never);
 const outside=action("rok");outside.action.value.game_codes=["samo"];expect((await handler(outside)).toast?.type).toBe("error");
 const expired=action();expired.action.value.expires_at=new Date(Date.now()-1000).toISOString();expect((await handler(expired)).toast?.content).toContain("有效期");
 expect((await handler(action("d1"))).toast?.type).toBe("error");expect(reads).toBe(0);
});
test("慢查询立即应答，完成后更新转发消息卡片",async()=>{
 let resolve:any;const pending=new Promise<any>(r=>{resolve=r;});const updates:any[]=[];
 const handler=createA2CardActionHandler({view:()=>pending} as never,async(id,card)=>{updates.push({id,card});},2);
 const response=await handler(action());expect(response.toast?.content).toContain("多维表");expect(response.card).toBeUndefined();
 resolve({cards:[{schema:"2.0",header:{title:{content:"updated"}}}]});await new Promise(r=>setTimeout(r,5));expect(updates[0].id).toBe("forwarded-message");
});
test("A2 回调和正常日报回调分流",async()=>{
 let project=0,a2=0;const router=routeReportCardActions(async()=>{project++;return{};},async()=>{a2++;return{};});
 await router(action());await router({action:{value:{action:"select_period"}}});expect(a2).toBe(1);expect(project).toBe(1);
});
