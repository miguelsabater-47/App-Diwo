import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as feedback from "../lib/door-scan-feedback.ts";
import * as model from "../lib/door-scan-model.ts";

test("internal outcomes reduce to only three ticket states in the door UI", () => {
  const outcomes=["admitted","already_used","revoked","wrong_event","unknown"];
  assert.deepEqual([...new Set(outcomes.map(outcome => feedback.scanFeedback(outcome).title))],["Entrada validada","Entrada ya usada","Entrada no válida"]);
  for (const outcome of ["revoked", "wrong_event", "unknown"]) assert.deepEqual(feedback.scanFeedback(outcome), feedback.scanFeedback("unknown"));
  for (const outcome of outcomes) {
    const result=feedback.scanFeedback(outcome);
    assert.equal(result.tone,outcome === "admitted" ? "success" : "rejected");
    assert.match(feedback.scanFeedbackStyle(result.tone),outcome === "admitted" ? /green/ : /red/);
  }
});
test("unconfirmed result is a separate amber warning, never validated or an incorrect ticket", () => {
  const result=feedback.scanFeedback("connection_error");
  assert.equal(result.title,"No se ha podido comprobar"); assert.equal(result.tone,"unconfirmed");
  assert.match(result.detail,/No autorices el acceso/); assert.match(feedback.scanFeedbackStyle(result.tone),/amber/);
});
const nodes = node => !node || typeof node !== "object" ? [] : [node,...[node.props?.children].flat(Infinity).flatMap(nodes)];
const text = node => node == null || typeof node === "boolean" ? "" : Array.isArray(node) ? node.map(text).join(" ") : typeof node === "object" ? text(node.props?.children) : String(node);
const tick = () => new Promise(resolve => setImmediate(resolve));
test("real scanner renders shared headlines, reasons and fail-closed errors without retrying", async () => {
  const source=ts.transpileModule(readFileSync(new URL("../components/door-scanner.tsx",import.meta.url),"utf8"),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022 } }).outputText;
  for (const outcome of ["admitted","already_used","revoked","wrong_event","unknown","network","malformed"]) {
    const slots=[],effects=[],cameras=[],writes=[]; let index=0;
    const eventId="6d29371c-0dd4-4661-b107-f44409d0ca20",ticketId="9a8edb5d-ce70-4ac6-8604-e6f74b93ba0f";
    const deps={
      "react/jsx-runtime":jsx,
      react:{
        useState(initial) { const n=index++; if (!(n in slots)) slots[n]=initial; return [slots[n],value => { slots[n]=typeof value === "function" ? value(slots[n]) : value; }]; },
        useRef(initial) { const n=index++; return slots[n] ?? (slots[n]={ current:initial }); },
        useEffect(fn,values) { const n=index++; if (!slots[n] || values.some((v,i) => !Object.is(v,slots[n].values[i]))) { const previous=slots[n]; slots[n]={ values }; effects.push(() => { previous?.cleanup?.(); slots[n].cleanup=fn(); }); } },
      },
      "@/components/ui/button":{ Button:"button" },"@/lib/door-scan-model":model,"@/lib/door-scan-feedback":feedback,
      "lucide-react": { ScanLine: "svg", Check: "svg", X: "svg", CircleAlert: "svg" },
      "@/lib/qr-frame-reader":{ createQrFrameReader:async () => ({ dispose() {} }) },
      "@/lib/door-camera-session":{ createDoorCameraSession(options) { cameras.push(options); return { start:async () => options.ready(),stop() {} }; } },
    };
    const fetch=async (url,init) => {
      assert.equal(url,"/api/door-scan");
      if (init.method !== "POST") return Response.json({ event:{ id:eventId,title:"Synthetic",used:0,pending:1,total:1 } });
      writes.push(JSON.parse(init.body)); if (outcome === "network") throw Error("Synthetic network failure");
      const identifiable=["admitted","already_used","revoked"].includes(outcome);
      return Response.json({ result:{ outcome,ticketId:identifiable ? ticketId : null,name:identifiable ? "Synthetic Person" : null,usedAt:["admitted","already_used"].includes(outcome) ? "2026-10-16T12:00:00Z" : null } });
    };
    const mod={ exports:{} };
    new Function("require","module","exports","document","navigator","fetch","setTimeout","clearTimeout",source)(name => { assert.ok(name in deps,`Unexpected dependency ${name}`); return deps[name]; },mod,mod.exports,{ hidden:false,addEventListener() {},removeEventListener() {} },{ mediaDevices:{} },fetch,() => 1,() => {});
    function render() {
      index=0; const tree=mod.exports.DoorScanner();
      for (const node of nodes(tree)) if (node.props?.ref && typeof node.props.ref === "object") node.props.ref.current=node.type === "video" ? {} : { focus() {} };
      while (effects.length) effects.shift()(); return tree;
    }
    render(); await tick(); const button=nodes(render()).find(n => n.type === "button" && text(n) === "Abrir escáner");
    assert.equal(button.props.disabled,false); await button.props.onClick();
    cameras[0].codes([{ rawValue:outcome === "malformed" ? "not-a-ticket" : "a".repeat(64) }]); await tick();
    const tree=render(),panel=nodes(tree).find(n => n.props?.role === "status" && n.props?.tabIndex === -1);
    const expected=feedback.scanFeedback(outcome === "network" ? "connection_error" : outcome === "malformed" ? "unknown" : outcome);
    assert.ok(panel); assert.equal(text(nodes(panel).find(n => n.type === "h2")),expected.title);
    assert.ok(text(panel).includes(expected.detail)); assert.ok(panel.props.className.includes(feedback.scanFeedbackStyle(expected.tone)));
    assert.equal(text(tree).includes("ejemplo"), false);
    assert.equal(text(tree).includes("ficticio"), false);
    assert.equal(writes.length,outcome === "malformed" ? 0 : 1);
    for (const slot of slots) slot?.cleanup?.();
  }
});
