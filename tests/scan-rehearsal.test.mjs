import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createScanRehearsal } from "../lib/scan-rehearsal.ts";
import * as rehearsalModel from "../lib/scan-rehearsal.ts";
import * as feedback from "../lib/door-scan-feedback.ts";
import { scanToken } from "../lib/door-scan-model.ts";
import { isLocalScanRehearsal } from "../lib/local-access.ts";

const id = "6d29371c-0dd4-4661-b107-f44409d0ca20";
const env = { NODE_ENV:"development",NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:"pk_test_synthetic",CLERK_SECRET_KEY:"sk_test_synthetic" };
test("synthetic fixture tokens cannot be real ticket tokens; repeated reads preserve first-use receipt", () => {
  const session = createScanRehearsal(id), valid = session.fixtures[0].token;
  assert.ok(session.fixtures.every(f => !scanToken(f.token)));
  assert.deepEqual(session.counts(),{ used:0,pending:1,total:1 });
  const first = session.read(valid); assert.equal(first.outcome,"admitted"); assert.ok(first.usedAt);
  assert.deepEqual(session.read(valid),{ ...first,outcome:"already_used" });
  assert.deepEqual(session.counts(),{ used:1,pending:0,total:1 });
});
test("offline, revoked, other-event, unknown and another tab never consume the valid fixture", () => {
  const session = createScanRehearsal(id), valid = session.fixtures[0].token;
  assert.equal(session.read(valid,false).outcome,"connection_error");
  for (const fixture of session.fixtures.slice(1)) assert.equal(session.read(fixture.token).outcome,fixture.kind);
  assert.equal(session.read("a".repeat(64)).outcome,"unknown");
  assert.equal(createScanRehearsal("8e349dcb-7209-4fdc-b7c1-dca5cd42cf94").read(valid).outcome,"unknown");
  assert.deepEqual(session.counts(),{ used:0,pending:1,total:1 });
  assert.equal(session.read(valid).outcome,"admitted");
});
test("rehearsal routing is exact, dev-key/local-origin-only; no broader scanner or admin exception", () => {
  for (const path of ["/admin/scan-rehearsal","/admin/scan-rehearsal/"]) assert.ok(isLocalScanRehearsal(path,"http://localhost:3000",env));
  for (const path of ["/scan","/scan/rehearsal","/admin/scan-rehearsal/child","/api/admin/rehearsal"]) assert.equal(isLocalScanRehearsal(path,"http://localhost:3000",env),false);
  for (const origin of ["https://example.invalid","http://127.0.0.1:3000","http://localhost:3001"]) assert.equal(isLocalScanRehearsal("/admin/scan-rehearsal",origin,env),false);
  for (const change of [{ NODE_ENV:"production" },{ CLERK_SECRET_KEY:"sk_live_synthetic" },{ NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:undefined }]) assert.equal(isLocalScanRehearsal("/admin/scan-rehearsal","http://localhost:3000",{ ...env,...change }),false);
});
test("page independently denies nonlocal/production/anonymous/staff and fails closed on unavailable role", async () => {
  const code = ts.transpileModule(readFileSync(new URL("../app/admin/scan-rehearsal/page.tsx",import.meta.url),"utf8"),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022 } }).outputText;
  async function run(change = {}) {
    let lookups=0;
    const config = { env,host:"localhost:3000",access:{ ok:true,role:"admin" },...change }, mod = { exports:{} };
    const deps = {
      "react/jsx-runtime":jsx,"next/headers":{ headers:async () => ({ get:() => config.host }) },
      "next/navigation":{ notFound:() => { throw Error("notFound"); },redirect:target => { throw Error(`redirect:${target}`); } },
      "@/lib/app-authorization":{ requireAdminAccess:async () => { lookups++; return config.access; } },
      "@/lib/local-access":{ hasDevelopmentClerkKeys:value => Boolean(value.CLERK_SECRET_KEY?.startsWith("sk_test_")) },
      "@/components/scan-rehearsal":{ ScanRehearsal:"rehearsal" },
    };
    new Function("require","module","exports","process",code)(name => { assert.ok(name in deps,`Unexpected dependency ${name}`); return deps[name]; },mod,mod.exports,{ env:config.env });
    try { return { tree:await mod.exports.default({ searchParams: Promise.resolve({ design: config.design }) }),lookups }; } catch(error) { return { error:error.message,lookups }; }
  }
  for (const change of [{ env:{ ...env,NODE_ENV:"production" } },{ host:"other.invalid" }]) assert.deepEqual(await run(change),{ error:"notFound",lookups:0 });
  assert.equal((await run({ access:{ ok:false,status:401 } })).error,"redirect:/sign-in");
  assert.equal((await run({ access:{ ok:false,status:403 } })).error,"notFound");
  assert.ok((await run({ access:{ ok:false,status:502 } })).tree.props.role === "alert");
  assert.ok((await run()).tree);
  assert.equal((await run({ design: "1" })).error, "redirect:/admin/scan");
  assert.equal((await run({ design: "1", access: { ok: false, status: 403 } })).error, "notFound");
  assert.deepEqual(await run({ design: "1", env: { ...env, NODE_ENV: "production" } }), { error: "notFound", lookups: 0 });
  assert.deepEqual(await run({ design: "1", host: "other.invalid" }), { error: "notFound", lookups: 0 });
});

const nodes = node => !node || typeof node !== "object" ? [] : [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);
const tick = () => new Promise(resolve => setImmediate(resolve));
test("rehearsal UI uses camera callbacks locally, labels all receipts, blocks double starts and ignores late reads", async () => {
  const code = ts.transpileModule(readFileSync(new URL("../components/scan-rehearsal.tsx",import.meta.url),"utf8"),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022 } }).outputText;
  const slots=[], effects=[], generated=[], cameras=[], listeners=new Map(); let index=0, networkCalls=0, imageCalls=0, pendingImage=null;
  const document = { hidden:false,addEventListener:(name,fn) => listeners.set(name,fn),removeEventListener:name => listeners.delete(name) };
  const deps = {
    "react/jsx-runtime":jsx,
    react:{
      useState(initial) { const n=index++; if (!(n in slots)) slots[n]=initial; return [slots[n],value => { slots[n]=typeof value === "function" ? value(slots[n]) : value; }]; },
      useRef(initial) { const n=index++; return slots[n] ?? (slots[n]={ current:initial }); },
      useEffect(fn,values) { const n=index++; if (!slots[n] || values.some((v,i) => !Object.is(v,slots[n].values[i]))) { const previous=slots[n]; slots[n]={ values }; effects.push(() => { previous?.cleanup?.(); slots[n].cleanup=fn(); }); } },
    },
    "@/components/ui/button":{ Button:"button" },"@/lib/scan-rehearsal":rehearsalModel,
    "@/lib/door-scan-feedback":feedback,
    "@/lib/qr-frame-reader":{ createQrFrameReader:async () => ({ dispose() {} }) },
    "@/lib/qr-image-reader":{ readQrImage:async file => { imageCalls++; return pendingImage ?? file.token; },qrImageErrorMessage:() => "Safe image failure" },
    "@/lib/door-camera-session":{ createDoorCameraSession(options) { const session={ options,stops:0,start:async () => options.ready(),stop() { this.stops++; } }; cameras.push(session); return session; } },
    qrcode:{ toDataURL:async token => { generated.push(token); return "data:image/png;base64,synthetic"; } },
  };
  const mod={ exports:{} };
  new Function("require","module","exports","document","navigator","fetch",code)(name => { assert.ok(name in deps,`Unexpected dependency ${name}`); return deps[name]; },mod,mod.exports,document,{ mediaDevices:{} },() => { networkCalls++; throw Error("Rehearsal must not fetch"); });
  function render() {
    index=0; const tree=mod.exports.ScanRehearsal();
    for (const node of nodes(tree)) if (node.props?.ref && typeof node.props.ref === "object") node.props.ref.current=node.type === "video" ? {} : { focus() {} };
    while (effects.length) effects.shift()(); return tree;
  }
  const button = label => { const found=nodes(render()).find(n => n.type === "button" && text(n) === label); assert.ok(found,`Missing ${label}`); return found; };
  render(); render(); await tick(); render();
  const valid=generated[0]; assert.equal(scanToken(valid),false);
  const upload=async file => {
    const input=nodes(render()).find(n => n.type === "input" && n.props.type === "file");
    const target={ files:file ? [file] : [],value:"synthetic.png" }; input.props.onChange({ currentTarget:target });
    assert.equal(target.value,""); await tick(); render();
  };
  await upload(null); assert.equal(imageCalls,0);
  await upload({ token:valid }); assert.match(text(render()),/Admisión simulada/); assert.equal(cameras.length,0);
  await upload({ token:valid }); assert.match(text(render()),/Entrada ya usada/);
  await upload({ token:null }); assert.match(text(render()),/No se ha encontrado un QR/); assert.equal(text(render()).includes("Admisión simulada"),false);
  let resolveImage; pendingImage=new Promise(resolve => { resolveImage=resolve; });
  await upload({ token:valid }); assert.equal(button("Abrir cámara del ensayo").props.disabled,true);
  const cameraCount=cameras.length; await button("Abrir cámara del ensayo").props.onClick(); assert.equal(cameras.length,cameraCount);
  button("Cancelar lectura de imagen").props.onClick(); resolveImage(valid); await tick();
  assert.equal(text(render()).includes("Admisión simulada"),false); pendingImage=null;
  const start=button("Abrir cámara del ensayo").props.onClick; const starting=start(); await start(); await starting;
  assert.equal(cameras.length,1);
  cameras[0].options.codes([{ rawValue:valid }]);
  assert.match(text(render()),/Entrada ya usada/); assert.match(text(render()),/No autoriza acceso real/);
  await button("Abrir cámara del ensayo").props.onClick(); cameras.at(-1).options.codes([{ rawValue:valid }]);
  assert.match(text(render()),/Entrada ya usada/);
  await button("Abrir cámara del ensayo").props.onClick(); const stale=cameras.at(-1);
  button("Detener cámara del ensayo").props.onClick(); stale.options.codes([{ rawValue:valid }]);
  assert.equal(text(render()).includes("Admisión simulada"),false);
  const checkbox=nodes(render()).find(n => n.type === "input" && n.props.type === "checkbox"); checkbox.props.onChange({ target:{ checked:true } });
  await button("Abrir cámara del ensayo").props.onClick(); cameras.at(-1).options.codes([{ rawValue:valid }]);
  assert.match(text(render()),/No se ha podido comprobar/);
  assert.equal(text(render()).includes("Entrada no válida"),false);
  await button("Abrir cámara del ensayo").props.onClick(); document.hidden=true; listeners.get("visibilitychange")();
  cameras.at(-1).options.codes([{ rawValue:valid }]); assert.equal(text(render()).includes("Admisión simulada"),false);
  for (const slot of slots) slot?.cleanup?.(); assert.equal(listeners.size,0); assert.equal(networkCalls,0);
});
