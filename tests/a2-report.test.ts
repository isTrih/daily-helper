import { expect, test } from "bun:test";
import { a2ReportRequest, A2_REPORT_GAMES, A2_DASHBOARD_URL, A2ReportService, buildA2Card, summarizeA2, wan, delta } from "../src/a2-report.ts";
const rows=Array.from({length:20},(_,i)=>({date:new Date(Date.UTC(2026,9,27+i)).toISOString().slice(0,10),A2:1000000+i*10000,other_A2:10000000+i*30000}));
const now=new Date("2026-11-17T03:00:00Z");
test("A2 只选择四款游戏，不接受 D1 或额外参数",()=>{
 expect(A2_REPORT_GAMES.map(g=>g.code)).toEqual(["w","rok","samo","pgame"]);
 expect(()=>a2ReportRequest.parse({gameCodes:["d1"]})).toThrow();
 expect(()=>a2ReportRequest.parse({gameCodes:["w"],periodIds:[1]})).toThrow();
 expect(a2ReportRequest.parse({gameCodes:["w","w"]}).gameCodes).toEqual(["w"]);
});
test("单游戏15日折线/面积双轴，统一万，排除尚不可用日期",()=>{
 const report=summarizeA2("samo","万龙觉醒",rows,now);
 expect(report.points).toHaveLength(15);expect(report.latest.date).toBe("2026-11-15");
 expect(report.previous!.date).toBe("2026-11-14");expect(report.week!.date).toBe("2026-11-08");
 const card=buildA2Card([report]);const chart=(card.body as any).elements.find((e:any)=>e.tag==="chart");
 expect(chart.chart_spec.series.map((s:any)=>s.type)).toEqual(["area","line"]);
 expect(chart.chart_spec.data[1].values.at(-1).value).toBe(report.latest.A2/10000);
 expect(chart.chart_spec.axes[1].title.text).toContain("万");expect(chart.height).toBe("280px");
 expect(wan(2657445)).toBe("265.74万");expect(delta(10000,0)).toContain("基数为零");
});
test("缺日不误用上一条，零基数和过期数据明确展示",()=>{
 const missing=rows.filter(r=>r.date!=="2026-11-14");
 const report=summarizeA2("w","战火勋章",missing,now);expect(report.previous).toBeUndefined();expect(report.missingDays).toBe(1);
 const stale=summarizeA2("w","战火勋章",rows.filter(r=>r.date<"2026-11-15"),now);expect(stale.stale).toBe(true);
 expect(JSON.stringify(buildA2Card([report,stale]))).toContain("暂无对照");
 expect(JSON.stringify(buildA2Card([report,stale]))).not.toContain('"tag":"chart"');
});
test("A2预览和发送仅从多维表读取，发送只投递所选群聊",async()=>{
 let reads=0;const sends:string[]=[];
 const service=new A2ReportService({readDaily:async()=>{reads++;return rows;}},{sendCard:async(chat)=>{sends.push(typeof chat === "string" ? chat : chat.id);return "msg";},updateCard:async()=>{}});
 const preview=await service.preview(["w","rok"]);expect(preview.cards).toHaveLength(1);expect(reads).toBe(2);
 await expect(service.preview(["d1"])).rejects.toThrow();
 const sent=await service.send(["w"],["chat","chat"]);expect(sent.messageCount).toBe(1);expect(sends).toEqual(["chat"]);
});

test("单游戏和概览卡片的看板按钮覆盖电脑、iOS、Android",()=>{const report=summarizeA2("samo","万龙觉醒",rows,now);for(const reports of [[report],[report,{...report,code:"w",name:"战火勋章"}]]){const button=(buildA2Card(reports).body as any).elements.find((e:any)=>e.element_id==="a2_dashboard");expect(button.text.content).toBe("看板及数据");for(const key of ["default_url","pc_url","ios_url","android_url"])expect(button.behaviors[0][key]).toBe(A2_DASHBOARD_URL);}});

test("游戏配色、红涨绿跌及占比分档，超过100%不截断数值",async()=>{
 const {A2_THEMES,brandShare,coloredDelta,a2Footnote,A2_CONTACT_ID}=await import("../src/a2-report.ts");
 expect(Object.values(A2_THEMES).map(t=>t.template)).toEqual(["grey","yellow","red","purple"]);
 expect(coloredDelta(20,10)).toContain("color='red'");expect(coloredDelta(10,20)).toContain("color='green'");
 for(const [own,tier]of [[0,0],[19,0],[20,1],[40,2],[60,3],[80,4],[100,4],[150,4]])expect(brandShare(own!,100).tier).toBe(tier!);
 expect(brandShare(150,100).text).toBe("150.00%");expect(brandShare(10,0).text).toBe("暂无对照");
 const notes=JSON.stringify(a2Footnote({gameCodes:["samo"],selectedGame:"samo",reportDate:"2026-11-15",expiresAt:new Date(Date.now()+86400000).toISOString()}));
 expect(notes).toContain("有疑问找");expect(notes).toContain(A2_CONTACT_ID);expect(notes).toContain("可互动有效期");expect(notes).not.toContain("更新于");expect(notes).not.toContain("数据来源");expect(notes).not.toContain("占比");
});

test("先发读取小卡片，再读多维表，完成后原消息更新且不重复发送",async()=>{
 const events:string[]=[];let resolveRows!:(value:typeof rows)=>void;const pending=new Promise<typeof rows>(resolve=>{resolveRows=resolve;});const updates:any[]=[];
 const service=new A2ReportService({readDaily:async()=>{events.push("read");return pending;}},{sendCard:async(chat,card)=>{events.push("send:"+chat);expect((card.header as any).title.content).toContain("正在读取");return"loading-message";},updateCard:async(id,card)=>{events.push("update:"+id);updates.push(card);}});
 const work=service.send(["samo"],["private-chat"]);await new Promise(r=>setTimeout(r,0));
 expect(events).toEqual(["send:private-chat","read"]);expect(updates).toHaveLength(0);
 resolveRows(rows);const result=await work;expect(result.messageCount).toBe(1);expect(events).toEqual(["send:private-chat","read","update:loading-message"]);expect(updates[0].header.title.content).toContain("万龙觉醒");
});
test("读取失败时将原读取卡片更新为失败提示",async()=>{
 const updates:any[]=[];let sends=0;
 const service=new A2ReportService({readDaily:async()=>{throw Error("fixture timeout");}},{sendCard:async()=>{sends++;return"loading-message";},updateCard:async(id,card)=>{updates.push({id,card});}});
 await expect(service.send(["samo"],["private-chat"])).rejects.toThrow("fixture timeout");expect(sends).toBe(1);expect(updates[0].id).toBe("loading-message");expect(updates[0].card.header.title.content).toContain("读取失败");
});

test("A2混合目标先投递读取卡片、群失败不阻断私聊，私聊默认万国觉醒", async () => {
 const sends:any[]=[];const updates:any[]=[];const reads:string[]=[];
 const service=new A2ReportService({readDaily:async name=>{reads.push(name);return rows;}},{sendCard:async(target,card)=>{sends.push(target);if(typeof target==='string')throw Error('group unavailable');return 'om_private';},updateCard:async(id,card)=>{updates.push({id,card});}});
 await expect(service.send(['w','rok','samo','pgame'],[{type:'chat',id:'oc_bad'},{type:'user',id:'ou_good'}])).rejects.toThrow('1/2');
 expect(sends).toEqual(['oc_bad',{type:'user',id:'ou_good'}]);expect(reads).toEqual(['万国觉醒']);expect(updates).toHaveLength(1);
 expect(JSON.stringify(updates[0].card)).toContain('"initial_option":"rok"');expect(updates[0].card.config.enable_forward).toBe(true);
});
