import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../src/server.ts";
import { readConfig } from "../src/config.ts";
import { A2Service } from "../src/a2-service.ts";

test("上传无需令牌但校验协议、严格结构和来源；管理状态仍受保护", async()=>{
 const dir=await mkdtemp(join(tmpdir(),"a2-http-"));
 const config=readConfig({INTERNAL_API_TOKEN:"test",A2_UPLOAD_TOKEN:"upload-fixture",HOST:"127.0.0.1"});
 const service=new A2Service({...config.a2,dir,appId:"test",appSecret:"test"});
 const server=startServer({config:{...config,port:0},reportService:{} as never,orchestrator:{} as never,a2Service:service});
 const base=`http://127.0.0.1:${server.port}`;
 try {
   expect((await fetch(base+"/api/a2/status")).status).toBe(401);
   const headers={"Content-Type":"application/json","X-A2-Upload":"yuntu-session-v1"};
   const adminHeaders={Authorization:"Bearer upload-fixture"};
   const auth={cookies:[{name:"session",value:"secret-fixture",domain:".oceanengine.com",path:"/",secure:true,httpOnly:true,expires:-1,sameSite:"Lax"}],requests:[{url:"https://yuntu.oceanengine.com/yuntu_ng/api/v1/get_audience_asset_profile?aadvid=1793391127052291&brand_id=123"}]};
   expect((await fetch(base+"/api/a2/auth",{method:"POST",headers,body:JSON.stringify(auth)})).status).toBe(200);
   const status=await (await fetch(base+"/api/a2/status",{headers:adminHeaders})).text();
   expect(status).toContain('"hasAuth":true'); expect(status).not.toContain("secret-fixture");
   expect((await fetch(base+"/api/a2/auth",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(auth)})).status).toBe(415);
   expect((await fetch(base+"/api/a2/auth",{method:"POST",headers:{...headers,Origin:"https://evil.example"},body:JSON.stringify(auth)})).status).toBe(403);
   expect((await fetch(base+"/api/a2/auth",{method:"POST",headers,body:JSON.stringify({...auth,unexpected:true})})).status).toBe(400);
   expect((await fetch(base+"/api/a2/auth",{method:"POST",headers,body:"{"})).status).toBe(400);
   auth.requests[0]!.url="https://example.com/steal";
   expect((await fetch(base+"/api/a2/auth",{method:"POST",headers,body:JSON.stringify(auth)})).status).toBe(400);
 } finally {server.stop(true);await rm(dir,{recursive:true,force:true});}
});

test("A2 页面、预览和计划独立于项目数据源，四游戏校验并隔离计划",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"a2-independent-"));
 const {ScheduleService}=await import("../src/schedule-service.ts");
 const projectSchedules=new ScheduleService(join(dir,"project.json"),"Asia/Shanghai",async()=>{});
 const a2Schedules=new ScheduleService(join(dir,"a2.json"),"Asia/Shanghai",async()=>{});
 await projectSchedules.initialize();await a2Schedules.initialize();
 const config=readConfig({INTERNAL_API_TOKEN:"test",HOST:"127.0.0.1"});let projectCalls=0;
 const server=startServer({config:{...config,port:0},reportService:{listPeriods:async()=>{projectCalls++;throw Error("project source unavailable");}} as never,orchestrator:{} as never,
  a2Reports:{preview:async(codes:string[])=>({cards:[{header:{title:{content:"A2"}}}],reports:codes}),send:async()=>({messageCount:1})} as never,a2Schedules,scheduleService:projectSchedules});
 const base=`http://127.0.0.1:${server.port}`;const headers={"Content-Type":"application/json"};
 try{
  const boot=await(await fetch(base+"/api/a2/reports/bootstrap")).json() as any;expect(boot.games.map((g:any)=>g.code)).toEqual(["w","rok","samo","pgame"]);expect(projectCalls).toBe(0);
  expect((await fetch(base+"/a2")).status).toBe(200);
  expect((await fetch(base+"/api/a2/reports/preview",{method:"POST",headers,body:JSON.stringify({gameCodes:["samo"]})})).status).toBe(200);
  expect((await fetch(base+"/api/a2/reports/preview",{method:"POST",headers,body:JSON.stringify({gameCodes:["d1"]})})).status).toBe(400);
  const payload={name:"A2 fixture",chatId:"chat",time:"09:05",enabled:false,gameCodes:["w","rok"]};
  const created=await(await fetch(base+"/api/a2/reports/schedules",{method:"POST",headers,body:JSON.stringify(payload)})).json() as any;
  expect(created.schedule.request.a2GameCodes).toEqual(["w","rok"]);expect(projectSchedules.list()).toHaveLength(0);expect(a2Schedules.list()).toHaveLength(1);
  const edit=await fetch(base+"/api/a2/reports/schedules/"+created.schedule.id,{method:"PUT",headers,body:JSON.stringify({...payload,gameCodes:["samo"]})});expect(edit.status).toBe(200);
  expect((await fetch(base+"/api/a2/reports/schedules/"+created.schedule.id,{method:"DELETE"})).status).toBe(200);expect(a2Schedules.list()).toHaveLength(0);
 }finally{server.stop(true);projectSchedules.stop();a2Schedules.stop();await rm(dir,{recursive:true,force:true});}
});
