import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const source = ts.transpileModule(readFileSync(new URL("../lib/event-control-realtime.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture({ missing=false, fail=false }={}) {
  const calls=[],timers=new Map();let receive,subscribe;const mod={exports:{}};
  const channel={on(type,filter,fn){calls.push(["on",type,filter]);receive=fn;return this;},subscribe(fn){calls.push(["subscribe"]);subscribe=fn;return this;}};
  const client={channel(topic,config){calls.push(["channel",topic,config]);return channel;},realtime:{async setAuth(){calls.push(["auth"]);if(fail)throw Error("fixture_unavailable");}},removeChannel(ch){assert.equal(ch,channel);calls.push(["remove"]);return Promise.resolve();}};
  new Function("require","module","exports","process","setInterval","clearInterval",source)(()=>({createClient(url,key,options){calls.push(["client",url,key,options]);return client;}}),mod,mod.exports,{env:missing?{}:{NEXT_PUBLIC_SUPABASE_URL:"https://aaaaaaaaaaaaaaaaaaaa.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture"}},(fn,ms)=>{timers.set(1,{fn,ms});return 1;},id=>timers.delete(id));
  return {subscribe:mod.exports.subscribeEventControl,calls,timers,signal:()=>receive?.({payload:{ignored:"not_a_row"}}),connected:()=>subscribe?.("SUBSCRIBED")};
}
test("Realtime receives only private invalidations, authenticates before subscribe, renews and disposes cleanly",async()=>{
  const f=fixture();let changed=0;
  const dispose=f.subscribe("fixture-event",async()=>"fixture-token",()=>changed++);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(f.calls.find(c=>c[0]==="channel"),["channel","diwo:event:fixture-event",{config:{private:true}}]);
  assert.deepEqual(f.calls.find(c=>c[0]==="on").slice(1),["broadcast",{event:"changed"}]);
  assert.ok(f.calls.findIndex(c=>c[0]==="auth")<f.calls.findIndex(c=>c[0]==="subscribe"));
  const options=f.calls.find(c=>c[0]==="client")[3];
  assert.equal(await options.accessToken(),"fixture-token");assert.equal(options.auth.persistSession,false);
  f.connected();f.signal();assert.equal(changed,2);
  assert.equal(f.timers.get(1).ms,30000);f.timers.get(1).fn();
  dispose();f.signal();assert.equal(changed,2);assert.equal(f.timers.size,0);assert.ok(f.calls.some(c=>c[0]==="remove"));
  assert.ok(!f.calls.some(c=>["postgres_changes","send","from"].includes(c[0])));
});
test("missing/failed Realtime does not fabricate connectivity or admission; cleanup handles pending auth",async()=>{
  const missing=fixture({missing:true});missing.subscribe("event",async()=>null,()=>assert.fail("no signal"))();assert.equal(missing.calls.length,0);
  const failed=fixture({fail:true});const dispose=failed.subscribe("event",async()=>null,()=>assert.fail("no signal"));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(failed.calls.some(c=>c[0]==="subscribe"),false);dispose();
  const pending=fixture();const close=pending.subscribe("event",async()=>null,()=>assert.fail("disposed"));close();await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.calls.some(c=>c[0]==="subscribe"),false);
});
