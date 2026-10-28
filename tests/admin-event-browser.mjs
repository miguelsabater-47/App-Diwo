// Isolated browser harness: real component/styles, synthetic test transport only.
// Does not log in, use cookies/credentials, or call the app/database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import ts from "typescript";
import { createPreviewTransport } from "./helpers/event-control-preview-transport.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const temp = "C:/Users/Miguel/AppData/Local/Temp/opencode";
const inspectPreview = process.argv.includes("--check-preview");
const preview = process.argv.includes("--preview") || inspectPreview;
const require = createRequire(import.meta.url), modules = [], ids = new Map();
function bundle(file) {
  if (ids.has(file)) return ids.get(file);
  const id = modules.length; ids.set(file, id); modules.push("");
  let source = file.endsWith(".tsx") || file.endsWith(".ts") ? ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText : readFileSync(file, "utf8");
  source = source.replace(/require\(["']([^"']+)["']\)/g, (_, name) => {
    if (name === "@clerk/nextjs") return `({useAuth:()=>({userId:'user_browser_fixture',isLoaded:true}),useUser:()=>({user:{firstName:'Miguel',hasImage:false}})})`;
    if (name === "@/lib/event-control-realtime") return preview
      ? `({subscribeEventControl:(_event,_token,changed)=>{const s=new EventSource('/signals');s.addEventListener('changed',()=>{testState.signals=(testState.signals||0)+1;changed();});return()=>s.close();}})`
      : `({subscribeEventControl:(_event,_token,changed)=>{window.addEventListener('diwo-test-signal',changed);return()=>window.removeEventListener('diwo-test-signal',changed);}})`;
    if (name === "next/navigation") return `({usePathname:()=>new URLSearchParams(location.search).get('role')==='staff'?'/door':'/admin'})`;
    if (name === "@/components/buyer-tab-navigation") return `({BuyerTabPrefetch:__r(${bundle(require.resolve("react"))}).createContext({enabled:false,homeHref:'/'})})`;
    if (name === "next/image") return `({__esModule:true,default:({priority,unoptimized,...p})=>__r(${bundle(require.resolve("react"))}).createElement('img',p)})`;
    if (["@/components/admin-tab-link", "@/components/buyer-flow-link", "next/link"].includes(name)) {
      const link = preview
      ? `({AdminTabLink:p=>__r(${bundle(require.resolve("react"))}).createElement('a',{...p,href:'#',onClick:e=>{e.preventDefault();window.dispatchEvent(new CustomEvent('diwo-preview-route',{detail:p.href}));}},p.children)})`
      : `({AdminTabLink:p=>__r(${bundle(require.resolve("react"))}).createElement('a',p)})`;
      if (name === "@/components/buyer-flow-link") return link.replace("AdminTabLink:", "BuyerFlowLink:");
      if (name === "next/link") return link.replace("({AdminTabLink:", "({__esModule:true,default:");
      return link;
    }
    const target = name.startsWith("@/") ? path.join(root, name.slice(2)) : name.startsWith(".") ? path.resolve(path.dirname(file), name) : require.resolve(name);
    const resolved = /\.[cm]?jsx?$|\.tsx?$/.test(target) ? target : `${target}.ts`;
    return `__r(${bundle(resolved)})`;
  });
  modules[id] = `function(module,exports){${source}\n}`; return id;
}
const component = bundle(path.join(root, "components/admin-event-dashboard.tsx"));
const appNavigation = preview ? bundle(path.join(root, "components/app-navigation.tsx")) : null;
const authHeader = preview ? bundle(path.join(root, "components/auth-header.tsx")) : null;
const react = bundle(require.resolve("react")), dom = bundle(require.resolve("react-dom/client"));
const model = bundle(path.join(root, "lib/admin-event-model.ts"));
const navigation = `<div class="diwo-app-navigation-shade"></div><nav class="diwo-app-navigation diwo-app-navigation-admin"><div class="diwo-app-navigation-items diwo-app-navigation-items-admin" style="--tab-count:3;--tab-index:0"><a class="diwo-app-tab diwo-app-tab-admin diwo-app-tab-active" href="#">Inicio</a><a class="diwo-app-tab diwo-app-tab-admin" href="#">Entradas</a><a class="diwo-app-tab diwo-app-tab-admin" href="#">Personal</a></div></nav>`;
const bootstrap = `const process={env:{NODE_ENV:'production'}};const modules=[${modules.join(",")}],cache={};function __r(id){if(cache[id])return cache[id].exports;const m={exports:{}};cache[id]=m;modules[id](m,m.exports);return m.exports;}
const event={id:'99233d64-f779-4a4b-8f7e-634a5ee4ed94',title:${JSON.stringify(preview ? "DIWO X 2.0" : "Synthetic event")},timezone:'Europe/Madrid',starts_at:'2026-10-31T22:30Z',ends_at:'2026-11-01T06:00Z'};
const demoNames=['Alejandro García','María López','Pablo Martínez','Lucía Fernández','Diego Ruiz','Elena Sánchez','Carlos Romero','Ana Torres','Álex García','Marta Navarro'];
const rows=Array.from({length:${preview ? 142 : 140}},(_,i)=>({id:'5ba7d710-cb52-4053-8b7e-'+String(i+1).padStart(12,'0'),event_id:event.id,order_id:event.id,ticket_position:i+1,orders:{reference:${preview ? "'A7K2'" : "'TEST'"},status:'confirmed'},attendee_name:${preview ? "demoNames[i%10]" : "i===100?'Álex García':('Synthetic Guest '+(i+1))"},status:i<95?'used':${preview ? "i>=140?'revoked':'valid'" : "'valid'"},used_at:i<95?new Date(Date.parse('2026-11-01T00:42Z')-i*60000).toISOString():null}));
const nativePrototypeFetch=window.fetch.bind(window);
window.testState={offline:false,writes:0,deny:false,loseResponse:false};
window.fetch=async(url,options={})=>{if(testState.offline)throw Error('offline');if(testState.deny)return new Response('{}',{status:403});
if(options.method==='POST'){testState.writes++;const body=JSON.parse(options.body),row=rows.find(r=>r.id===body.ticketId);if(!row)return Response.json({result:{outcome:'unknown',ticketId:null,name:null,usedAt:null}});if(row.status==='revoked')return Response.json({result:{outcome:'revoked',ticketId:row.id,name:row.attendee_name,usedAt:null}});const outcome=row.status==='used'?'already_used':'admitted';row.status='used';row.used_at='2026-11-01T01:00:00Z';if(testState.loseResponse)throw Error('lost response after commit');return Response.json({result:{outcome,ticketId:row.id,name:row.attendee_name,usedAt:row.used_at}});}
const u=new URL(url,location.href);return Response.json(__r(${model}).eventControl(event,rows,u.searchParams.get('q')||'',Number(u.searchParams.get('page')||0),new Date('2026-11-01T00:42Z')));};
${preview ? `window.fetch=async(url,options={})=>{const u=new URL(url,location.href);if(u.origin!==location.origin||u.pathname!=='/api/door/event-control')throw Error('isolated_transport_only');return nativePrototypeFetch(options.method==='POST'?'/admit':'/snapshot'+u.search,{...options,credentials:'omit'});};` : ""}
const prototypeRole=new URLSearchParams(location.search).get('role')==='staff'?'door_staff':'admin';
__r(${dom}).createRoot(document.getElementById('root')).render(__r(${react}).createElement(__r(${component}).AdminEventDashboard,{role:prototypeRole}));
${preview ? `__r(${dom}).createRoot(document.getElementById('app-header')).render(__r(${react}).createElement(__r(${authHeader}).default));__r(${dom}).createRoot(document.getElementById('app-navigation')).render(__r(${react}).createElement(__r(${appNavigation}).AppNavigation,{role:prototypeRole}));` : ""}`;
const css = ["login-screen.css", "app-interface.css", "admin-event-dashboard.css"].map(f => readFileSync(path.join(root, "components", f), "utf8")).join("\n");
const previewControls = preview ? `function previewRoute(route){if(route==='/admin'||route==='/'||route==='/door'){location.reload();return;}if(route!=='/admin/scan'&&route!=='/scan')return;const d=document.createElement('dialog');d.className='diwo-event-dialog';d.innerHTML='<h2>Escáner QR</h2><div style="aspect-ratio:1;border:2px solid #fce921;border-radius:16px;background:#000;margin:24px 0"></div><p>Coloca el código QR dentro del marco.</p><button autofocus>Cerrar</button>';d.querySelector('button').onclick=()=>{d.close();d.remove();};d.addEventListener('cancel',()=>d.remove());document.body.append(d);d.showModal();}window.addEventListener('diwo-preview-route',e=>previewRoute(e.detail));` : "";
function pureModule(file) {
  const mod = { exports: {} };
  new Function("require","module","exports",ts.transpileModule(readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>pureModule(path.resolve(path.dirname(file),`${name}.ts`)),mod,mod.exports);
  return mod.exports;
}
const transport = preview ? createPreviewTransport(pureModule(path.join(root,"lib/admin-event-model.ts")).eventControl) : null;
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${server.address().port}`);
  if (req.headers.host !== url.host) { res.statusCode=403;res.end();return; }
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src ${preview ? "'self'" : "'none'"}; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
  if (transport && await transport(req,res,url)) return;
  if (req.method === "GET" && req.url === "/favicon.ico") { res.statusCode = 204; res.end(); return; }
  if (req.method === "GET" && req.url === "/brand/diwo-club.svg") { res.setHeader("Content-Type", "image/svg+xml"); res.end(readFileSync(path.join(root, "public/brand/diwo-club.svg"))); return; }
  if (req.method !== "GET" || (url.pathname !== "/" && !/^\/fonts\/Satoshi-(Light|Regular|Medium|Bold|Black)\.woff2$/.test(req.url))) { res.statusCode = 404; res.end("Local prototype only"); return; }
  if (/^\/fonts\/Satoshi-(Light|Regular|Medium|Bold|Black)\.woff2$/.test(req.url)) { res.setHeader("Content-Type", "font/woff2"); res.end(readFileSync(path.join(root, "public", req.url))); return; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIWO CLUB</title><style>*{box-sizing:border-box}body{margin:0;background:#000}button,input,a{font:inherit}button{border:0;background:none;color:inherit}svg{display:inline-block}.size-5{width:20px;height:20px}a{color:inherit;text-decoration:none}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden}${css}</style><body><div class="diwo-app-interface">${preview ? '<div id="app-header"></div>' : ''}<main class="diwo-app-main"><div id="root"></div></main>${preview ? '<div id="app-navigation"></div>' : navigation}</div><script>${bootstrap.replaceAll("</script", "<\\/script")}${previewControls}</script>`);
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(preview && !inspectPreview ? 3010 : 0, "127.0.0.1", resolve); });
if (preview && !inspectPreview) {
  console.log("Isolated local prototype: http://127.0.0.1:3010/ — synthetic in-memory data only; no auth, backend, camera or persistence.");
  await new Promise(resolve => server.once("close", resolve));
  process.exit(0);
}
const profile = path.join(temp, `diwo-dashboard-browser-${Date.now()}`); await mkdir(profile);
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const endpoint = await new Promise((resolve, reject) => { let text = ""; const timer = setTimeout(() => reject(Error("Chrome startup timeout")), 15000); chrome.stderr.on("data", chunk => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } }); chrome.once("error", reject); });
const socket = new WebSocket(endpoint); await new Promise(resolve => socket.addEventListener("open", resolve, { once: true }));
let sequence = 0; const pending = new Map(), errors = [];
socket.addEventListener("message", event => { const msg = JSON.parse(event.data); if (msg.id) { const p = pending.get(msg.id); pending.delete(msg.id); if (msg.error) p.reject(Error(JSON.stringify(msg.error))); else p.resolve(msg.result); } else if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails.text); else if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") errors.push("console.error"); else if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") errors.push(msg.params.entry.text); });
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++sequence; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const call = (method, params = {}) => send(method, params, sessionId);
const evaluate = async expression => { const r = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
const clickText = text => evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Missing button');b.click();return true})()`);
try {
  await call("Runtime.enable"); await call("Log.enable"); await call("Page.enable");
  for (const width of [320, 375, 390, 430, 1280]) {
    await call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    await call("Page.navigate", { url: `http://127.0.0.1:${server.address().port}/` }); await delay(900);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true, `${width}: no horizontal overflow`);
    assert.equal(await evaluate("document.querySelector('.diwo-event-donut strong').textContent"), "68 %");
    const boxes = await evaluate("[...document.querySelector('.diwo-event-squares').children].map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height,x:e.getBoundingClientRect().x}))");
    assert.ok(Math.abs(boxes[0].w - boxes[0].h) < 1 && Math.abs(boxes[1].w - boxes[1].h) < 1 && boxes[1].x > boxes[0].x);
    const image = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(temp, `${inspectPreview ? "diwo-preview" : "diwo-dashboard"}-${width}.png`), Buffer.from(image.data, "base64"));
  }
  if (inspectPreview) {
    assert.equal(await evaluate("document.querySelectorAll('nav[aria-label=\"Administración\"] .diwo-app-tab svg').length"), 3);
    assert.equal(await evaluate("document.querySelector('.diwo-app-header .diwo-app-brand img').getAttribute('src')"), "/brand/diwo-club.svg");
    assert.equal(await evaluate("/prototipo|ficticio|demo|prueba/i.test(document.body.innerText)"), false);
    assert.equal(await evaluate("document.querySelector('.diwo-event-heading').textContent"), "Dashboard");
    assert.equal(await evaluate("document.querySelectorAll('.diwo-event-connection').length"), 1);
    assert.equal(await evaluate("document.querySelector('.diwo-event-attendance > header .diwo-event-connection').textContent"), "Sistema conectado");
    assert.equal(await evaluate("/generales|extras|Accesos acumulados|ocupación actual|En curso|Panel de administración/.test(document.querySelector('.diwo-event-dashboard').textContent)"), false);
    assert.equal(await evaluate("/Última comprobación|Actualización automática|Consultar solicitudes/.test(document.querySelector('.diwo-event-dashboard').textContent)"), false);
    await call("Emulation.setDeviceMetricsOverride", { width: 375, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate("document.querySelector('input').focus()"); await call("Input.insertText", { text: "Alejandro" }); await delay(600);
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.diwo-event-search input')).outlineStyle"),"none");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.diwo-event-search')).borderColor"),"rgb(119, 119, 119)");
    assert.equal(await evaluate("document.querySelectorAll('.diwo-event-accesses button').length"), 5);
    assert.equal(await evaluate("document.querySelector('.diwo-event-results').getBoundingClientRect().height <= 161"), true);
    assert.equal(await evaluate("document.getElementById('diwo-event-history-title').getBoundingClientRect().bottom < document.querySelector('nav[aria-label=\"Administración\"]').getBoundingClientRect().top"), true, "latest accesses heading remains above the bottom menu while searching");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.diwo-event-results .is-used')).color"), "rgb(102, 223, 131)");
    assert.equal(await evaluate("getComputedStyle(document.querySelector('.diwo-event-results .is-valid')).color"), "rgb(252, 233, 33)");
    assert.equal(await evaluate("[...document.querySelectorAll('.diwo-event-results > button')].every(b=>{const s=b.querySelector('.diwo-event-state').getBoundingClientRect(),a=b.lastElementChild.getBoundingClientRect();return s.right<=a.left && s.left>b.firstElementChild.getBoundingClientRect().left;})"), true);
    assert.equal(await evaluate("document.documentElement.scrollWidth <= innerWidth"), true);
    const searchImage = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(path.join(temp, "diwo-dashboard-search-375.png"), Buffer.from(searchImage.data, "base64"));
    // Two browser pages share only fictional server data. Staff confirms a manual
    // admission; the admin receives an empty SSE invalidation and rereads promptly.
    const peerTarget = await send("Target.createTarget", { url: "about:blank", newWindow: true });
    const peer = await send("Target.attachToTarget", { targetId: peerTarget.targetId, flatten: true });
    const peerEval = async expression => {
      const r = await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true},peer.sessionId);
      if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;
    };
    await send("Runtime.enable",{},peer.sessionId);
    await send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true},peer.sessionId);
    await send("Page.navigate",{url:`http://127.0.0.1:${server.address().port}/?role=staff`},peer.sessionId);await delay(700);
    assert.equal(await evaluate("document.visibilityState"),"visible","separate windows emulate two visible devices");
    assert.equal(await peerEval("document.querySelectorAll('.diwo-app-tab').length"),2);
    assert.equal(await peerEval("/Personal|Consultar solicitudes/.test(document.body.innerText)"),false);
    const staffImage=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false},peer.sessionId);
    await writeFile(path.join(temp,"diwo-preview-staff-390.png"),Buffer.from(staffImage.data,"base64"));
    await peerEval("document.querySelector('input').focus()");
    await send("Input.insertText",{text:"Elena"},peer.sessionId);await delay(500);
    await peerEval("document.querySelector('.diwo-event-results button:has(.is-valid)').click()");await delay(300);
    await peerEval("[...document.querySelectorAll('button')].find(b=>b.textContent==='Validar entrada').click()");await delay(50);
    const started=Date.now();
    await peerEval("[...document.querySelectorAll('button')].find(b=>b.textContent==='Confirmar acceso').click()");
    await delay(400);
    assert.equal(await evaluate("document.querySelector('.diwo-event-donut span').textContent"),"96 / 140");
    assert.equal(await evaluate("document.querySelector('.diwo-event-accesses strong').textContent"),"Elena Sánchez");
    assert.ok(await evaluate("testState.signals>=1"));assert.ok(await peerEval("testState.signals>=1"));
    assert.equal(await peerEval("document.querySelector('.diwo-event-detail .diwo-event-state').textContent"),"Utilizada");
    assert.ok(Date.now()-started<1500,"signal-based cross-page refresh does not wait for the3s polling fallback");
    await send("Target.closeTarget",{targetId:peerTarget.targetId});
    assert.deepEqual(errors, []);
    console.log("PASS: compact UI320/375/390/430/1280; admin/staff isolated pages, confirmed staff manual admission, actual local SSE signal and admin snapshot/history refresh within1.5s, no console errors. Supabase hosted transport not exercised.");
  } else {
  await call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate("document.querySelector('.diwo-event-scan').focus()");
  await call("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  await call("Input.dispatchKeyEvent", { type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  assert.equal(await evaluate("document.activeElement.tagName"), "INPUT", "keyboard moves from scanner to attendee search");
  await evaluate("document.querySelector('input').focus()");
  await call("Input.insertText", { text: "alex" }); await delay(600);
  assert.equal(await evaluate("document.querySelector('.diwo-event-results strong').textContent"), "Álex García");
  assert.equal(await evaluate("document.querySelectorAll('.diwo-event-accesses button').length"), 5, "latest accesses remain present during attendee search");
  await evaluate("document.querySelector('.diwo-event-results button').click()"); await delay(300);
  await clickText("Validar entrada"); assert.equal(await evaluate("document.activeElement.textContent"), "Cancelar");
  await clickText("Confirmar acceso"); await delay(400);
  assert.equal(await evaluate("testState.writes"), 1);
  assert.equal(await evaluate("document.querySelector('.diwo-event-detail .diwo-event-state').textContent"), "Utilizada");
  await clickText("Volver al panel"); await delay(300);
  await evaluate("document.querySelector('[aria-label=\"Borrar búsqueda\"]').click()"); await delay(600);
  assert.match(await evaluate("document.querySelector('.diwo-event-donut').textContent"), /96 \/ 140/);
  // Another device changes the backend fixture; the normal refresh path must see it.
  await evaluate("rows[97].status='used';rows[97].used_at='2026-11-01T01:02:00Z'");
  await delay(5100); await evaluate("window.dispatchEvent(new Event('online'))"); await delay(300);
  assert.match(await evaluate("document.querySelector('.diwo-event-donut').textContent"), /97 \/ 140/);
  await evaluate("testState.offline=true;window.dispatchEvent(new Event('offline'))"); await delay(50);
  assert.equal(await evaluate("document.querySelector('.diwo-event-connection').textContent"), "Sin conexión");
  await delay(100);
  assert.equal(await evaluate("testState.writes"), 1);
  await evaluate("testState.offline=false;window.dispatchEvent(new Event('online'))"); await delay(300);
  assert.equal(await evaluate("document.querySelector('.diwo-event-connection').textContent"), "Sistema conectado");
  // A lost mutation receipt is never announced as success or silently retried.
  await evaluate("document.querySelector('input').focus()"); await call("Input.insertText", { text: "Synthetic Guest 100" }); await delay(600);
  await evaluate("document.querySelector('.diwo-event-results button').click()"); await delay(300);
  await clickText("Validar entrada"); await evaluate("testState.loseResponse=true"); await clickText("Confirmar acceso"); await delay(400);
  assert.match(await evaluate("document.querySelector('.diwo-event-detail').textContent"), /Resultado sin confirmar/);
  assert.equal(await evaluate("testState.writes"), 2);
  await delay(200); assert.equal(await evaluate("testState.writes"), 2);
  await clickText("Volver al panel"); await delay(300);
  await evaluate("document.querySelector('[aria-label=\"Borrar búsqueda\"]').click()"); await delay(600);
  await clickText("Ver todos"); await delay(200);
  assert.equal(await evaluate("document.querySelectorAll('.diwo-event-accesses button').length"), 20);
  await clickText("Siguiente"); await delay(300);
  assert.match(await evaluate("document.querySelector('.diwo-event-pagination').textContent"), /2 \/ 5/);
  await evaluate("testState.deny=true"); await clickText("Anterior"); await delay(300);
  assert.match(await evaluate("document.body.textContent"), /permisos han cambiado/);
  assert.equal(await evaluate("document.querySelector('.diwo-event-accesses')===null"), true);
  assert.deepEqual(errors, []);
  console.log("PASS: real component/styles at 320/375/390/430/1280; search, detail, keyboard/focus, manual receipt, metrics, second-device refresh, history pagination, offline recovery, lost mutation receipt, revoked access; no console errors/runtime exceptions. Synthetic isolated transport, NOT signed/hosted proof.");
  }
} finally { socket.close(); chrome.kill(); await new Promise(resolve => server.close(resolve)); }
