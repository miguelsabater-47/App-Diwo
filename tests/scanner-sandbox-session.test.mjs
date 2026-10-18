import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { Script } from "node:vm";

const source=readFileSync(new URL("../scripts/verify-scanner-sandbox-session.browser.js",import.meta.url),"utf8");
const url="https://ofqywrjvzolmoqimkngt.supabase.co/rest/v1/rpc/get_current_app_role";
const key="sb_publishable_synthetic_sandbox_only",token="synthetic.native.session.token",actor="user_synthetic_actor",sessionId="sess_synthetic_private";
function fixture(options={}) {
  const requests=[],logs=[]; let prompts=0,tokens=0;
  const session={ id:sessionId,async getToken() { tokens++; return options.getToken ? options.getToken(context) : token; } };
  const clerk={ user:{ id:actor },session };
  const context={
    location:{ origin:options.origin ?? "http://localhost:3000" },AbortSignal,
    window:{ Clerk:options.signedOut ? null : clerk,prompt() { prompts++; return Object.hasOwn(options,"key") ? options.key : key; } },
    console:{ log:(...args) => logs.push(args) },
    fetch:async (target,init) => {
      requests.push({ target,init });
      if (options.fetch) return options.fetch(context);
      return { ok:!options.status || options.status===200,status:options.status ?? 200,
        json:async () => Object.hasOwn(options,"role") ? options.role : "user" };
    },
  };
  function safeLogs() {
    const output=JSON.stringify(logs);
    for (const secret of [key,token,actor,sessionId,"sb_secret_do_not_print"]) assert.equal(output.includes(secret),false,"Logs must not include credentials or private identity");
  }
  return { context,requests,logs,safeLogs,stats:() => ({ prompts,tokens }),run:() => new Script(source).runInNewContext(context) };
}
test("native signed read is pinned to sandbox RPC, omits cookies and emits only safe PASS metadata", async () => {
  const f=fixture(); await f.run(); assert.equal(f.requests.length,1); const { target,init }=f.requests[0];
  assert.equal(target,url); assert.equal(init.method,"POST"); assert.equal(init.body,"{}");
  assert.equal(init.credentials,"omit"); assert.equal(init.cache,"no-store"); assert.equal(init.redirect,"error"); assert.equal(init.referrerPolicy,"no-referrer");
  assert.equal(init.headers.apikey,key); assert.equal(init.headers.Authorization,`Bearer ${token}`);
  assert.equal(f.logs[0][0],"DIWO_SCANNER_SANDBOX_AUTH_PASS"); assert.equal(f.logs[0][1].sandboxRole,"user"); assert.equal(f.logs[0][1].writes,false);
  assert.deepEqual(f.stats(),{ prompts:1,tokens:1 }); assert.equal(f.context.window.__diwoScannerSandboxVerifyRunning,false); f.safeLogs();
});
test("wrong origin or missing session never prompts for a key or sends any request", async () => {
  for (const options of [{ origin:"https://example.invalid" },{ origin:"http://localhost:3001" },{ signedOut:true }]) {
    const f=fixture(options); await f.run(); assert.equal(f.requests.length,0); assert.deepEqual(f.stats(),{ prompts:0,tokens:0 });
    assert.equal(f.logs[0][0],"DIWO_SCANNER_SANDBOX_AUTH_STOPPED"); f.safeLogs();
  }
});
test("secret/legacy/invalid keys and cancelled prompt stop BEFORE obtaining a session token", async () => {
  for (const value of [null,"", "sb_secret_do_not_print","synthetic.legacy.jwt",` ${key}`]) {
    const f=fixture({ key:value }); await f.run(); assert.deepEqual(f.stats(),{ prompts:1,tokens:0 }); assert.equal(f.requests.length,0);
    assert.equal(f.logs[0][1].reason,value===null ? "publishable_key_cancelled" : "publishable_key_required"); f.safeLogs();
  }
});
test("HTTP errors/unexpected roles/upstream secrets never expose bodies or report a successful session", async () => {
  for (const status of [401,403,404,500]) {
    const f=fixture({ status }); await f.run(); assert.equal(f.requests.length,1); assert.equal(f.logs[0][0],"DIWO_SCANNER_SANDBOX_AUTH_STOPPED"); f.safeLogs();
  }
  for (const role of [null,"admin","door_staff",{ private:token }]) {
    const f=fixture({ role }); await f.run(); assert.equal(f.logs[0][1].reason,"sandbox_role_not_user"); f.safeLogs();
  }
  const failed=fixture({ fetch:async () => { throw Error("sb_secret_do_not_print"); } }); await failed.run();
  assert.equal(failed.logs[0][1].reason,"network_or_unexpected_failure"); failed.safeLogs();
});
test("account/session change while getting token or after request suppresses success without retry", async () => {
  const before=fixture({ getToken:context => { context.window.Clerk.user.id="user_other_synthetic"; return token; } });
  await before.run(); assert.equal(before.requests.length,0); assert.equal(before.logs[0][1].reason,"account_or_session_changed"); before.safeLogs();
  const after=fixture({ fetch:async context => { context.window.Clerk.session={ id:"sess_other_synthetic" }; return { ok:true,json:async () => "user" }; } });
  await after.run(); assert.equal(after.requests.length,1); assert.equal(after.logs[0][1].reason,"account_or_session_changed"); after.safeLogs();
});
test("in-place session ID mutation cannot pass the unchanged-session check", async () => {
  const f=fixture({ getToken:context => { context.window.Clerk.session.id="sess_changed_in_place"; return token; } });
  await f.run(); assert.equal(f.requests.length,0); assert.equal(f.logs[0][1].reason,"account_or_session_changed"); f.safeLogs();
});
test("duplicate invocation cannot start another read or release the first invocation's guard", async () => {
  let release; const pending=new Promise(resolve => { release=resolve; }); const f=fixture({ getToken:() => pending });
  const first=f.run(); await f.run(); assert.equal(f.logs[0][1].reason,"test_already_running"); assert.equal(f.context.window.__diwoScannerSandboxVerifyRunning,true);
  release(token); await first; assert.equal(f.requests.length,1); assert.equal(f.context.window.__diwoScannerSandboxVerifyRunning,false); f.safeLogs();
});
