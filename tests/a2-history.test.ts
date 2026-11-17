import { expect, test, spyOn } from "bun:test";
import { historyWindows, parseTrend } from "../src/a2-history.ts";
import { A2Base } from "../src/a2-service.ts";

test("全年历史以三月底查询首个90天，分段连续且无遗漏",()=>{
 const windows=historyWindows("2026-01-01","2026-11-15");
 expect(windows).toEqual([{start:"2026-01-01",end:"2026-03-31"},{start:"2026-04-01",end:"2026-06-29"},{start:"2026-06-30",end:"2026-09-27"},{start:"2026-09-28",end:"2026-11-15"}]);
 expect(()=>historyWindows("2026-02-30","2026-11-15")).toThrow();
 expect(()=>historyWindows("2026-11-15","2026-01-01")).toThrow();
});
test("趋势使用数值及其他品牌，截断窗口外日期，缺日和重复不补零",()=>{
 const point={date:"2026-01-01",cover_num:"885588",count_average:"10178321"};
 const payload={status:0,data:{BaseResp:{StatusCode:0},trend_points:[point,{...point,date:"2025-12-31"}]}};
 expect(parseTrend(payload,"2026-01-01","2026-01-01")).toEqual([{date:"2026-01-01",A2:885588,other_A2:10178321}]);
 expect(()=>parseTrend(payload,"2026-01-01","2026-01-02")).toThrow("缺少日期");
 expect(()=>parseTrend({...payload,data:{trend_points:[point,point]}},"2026-01-01","2026-01-01")).toThrow("日期重复");
});
test("批量写入按100条分批，已有日期更新，分页读回核验，千分位格式",async()=>{
 const store=new Map<string,any>();
 const rows=Array.from({length:205},(_,i)=>({date:new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10),A2:1000+i,other_A2:2000+i}));
 const millis=(date:string)=>Date.parse(date+"T00:00:00+08:00");
 store.set("existing",{record_id:"existing",fields:{日期:millis(rows[0]!.date),A2:0,other_A2:0}});
 const calls:Array<{path:string,body:any}>=[];
 const stub=spyOn(globalThis,"fetch").mockImplementation((async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  const u=new URL(String(input));const body=init?.body?JSON.parse(String(init.body)):undefined;calls.push({path:u.pathname,body});
  if(u.pathname.includes("tenant_access_token"))return Response.json({code:0,tenant_access_token:"test"});
  let data:any={};
  if(u.pathname.includes("get_node"))data={node:{obj_type:"bitable",obj_token:"base"}};
  else if(u.pathname.endsWith("/tables"))data={items:[{name:"万龙觉醒",table_id:"table"}]};
  else if(u.pathname.endsWith("/fields"))data={items:[{field_id:"date",field_name:"日期",type:5},{field_id:"a2",field_name:"A2",type:2,property:{formatter:"0"}},{field_id:"other",field_name:"other_A2",type:2,property:{formatter:"0"}}]};
  else if(u.pathname.endsWith("/batch_create")){for(const record of body.records){const id="new"+store.size;store.set(id,{record_id:id,...record});}data={records:body.records};}
  else if(u.pathname.endsWith("/batch_update")){for(const record of body.records)store.set(record.record_id,{...record,fields:{...store.get(record.record_id)?.fields,...record.fields}});data={records:body.records};}
  else if(u.pathname.endsWith("/records")){const offset=Number(u.searchParams.get("page_token")||0);const all=[...store.values()];data={items:all.slice(offset,offset+100).map(r=>({...r,fields:{...r.fields,A2:String(r.fields.A2),other_A2:String(r.fields.other_A2)}})),has_more:offset+100<all.length,page_token:String(offset+100)};}
  return Response.json({code:0,data});
 }) as typeof fetch);
 try{
  const sink=new A2Base("id","secret","wiki");const result=await sink.upsertMany("万龙觉醒",rows);
  expect(result).toEqual({created:204,updated:1,verified:205});
  expect(calls.filter(c=>c.path.endsWith("batch_create")).map(c=>c.body.records.length)).toEqual([100,100,4]);
  expect(calls.filter(c=>c.path.includes("/fields/")).every(c=>c.body.property.formatter==="1,000")).toBe(true);
  const rerun=await sink.upsertMany("万龙觉醒",rows);
  expect(rerun).toEqual({created:0,updated:205,verified:205});expect(store.size).toBe(205);
  for(const record of store.values()) delete record.fields["游戏"];
  const filled=await sink.populateGame("万龙觉醒");
  expect(filled).toEqual({updated:205,verified:205});
  expect([...store.values()].every(r=>r.fields["游戏"]==="万龙觉醒")).toBe(true);
  expect(calls.filter(c=>c.path.endsWith("batch_update")).at(-1)?.body.records.every((r:any)=>Object.keys(r.fields).join() === "游戏")).toBe(true);
 }finally{stub.mockRestore();}
});
