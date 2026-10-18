import assert from "node:assert/strict";
import { test } from "node:test";
import { X509Certificate } from "node:crypto";
import { Script } from "node:vm";
import { createServer, get } from "node:https";
import { checkServerIdentity } from "node:tls";
import QRCode from "qrcode";
import { createCertificates, assets, handler, privateIPv4, sameSubnet } from "../scripts/scan-https/server.mjs";

const host="192.168.1.34",mask="255.255.255.0";
test("standalone TLS certificates, route isolation and browser module allowlist", { timeout:30000 }, async t => {
  const certificates=createCertificates(host),built=await assets(host,certificates);
  await t.test("24-hour CA and server cert have valid chain, SHA256 signature, exact IP and no persisted root key", () => {
    const root=new X509Certificate(certificates.ca),leaf=new X509Certificate(certificates.cert);
    assert.equal(root.ca,true); assert.equal(leaf.ca,false); assert.equal(root.verify(root.publicKey),true); assert.equal(leaf.verify(root.publicKey),true);
    assert.equal(leaf.checkIP(host),host); assert.equal(leaf.checkIP("192.168.1.99"),undefined);
    assert.ok(Date.parse(root.validTo)-Date.now()<=86400000); assert.ok(Date.parse(root.validTo)>Date.now());
    assert.equal(certificates.rootKey,undefined); assert.equal(certificates.fingerprint,root.fingerprint256);
    assert.deepEqual(certificates.der,root.raw);
  });
  await t.test("bundle contains only fixed rehearsal modules and no app auth/config, syntax is valid", () => {
    const bundle=built.secure.get("/bundle.js").body.toString(); new Script(bundle);
    assert.equal(/CLERK_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY|app-authorization|door-scan-core|createSessionSupabaseClient/.test(bundle),false);
    assert.ok(bundle.includes("DIWO-REHEARSAL-v1"));
    assert.ok(bundle.includes("camera_canvas_unavailable"));
    assert.equal(built.bootstrap.has("/bundle.js"),false); assert.equal(built.bootstrap.has("/fixtures.json"),false);
    for (const map of [built.secure,built.bootstrap]) for (const asset of map.values()) assert.equal(asset.body.includes("PRIVATE KEY"),false);
  });
  await t.test("actual browser bundle boots and shared software camera reads twice with no scan API", async () => {
    const session=JSON.parse(built.secure.get("/fixtures.json").body).session;
    const qr=QRCode.create(`DIWO-REHEARSAL-v1:${session}:valid`),size=(qr.modules.size+8)*6,pixels=new Uint8ClampedArray(size*size*4);
    for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
      const row=Math.floor(y/6)-4,col=Math.floor(x/6)-4;
      const dark=row>=0 && col>=0 && row<qr.modules.size && col<qr.modules.size && qr.modules.get(row,col);
      pixels.set([dark?0:255,dark?0:255,dark?0:255,255],(y*size+x)*4);
    }
    const elements=new Map(); let stopped=0;
    const node=() => ({ disabled:false,hidden:false,checked:false,value:"valid",events:new Map(),append() {},focus() {},addEventListener(name,callback) { this.events.set(name,callback); } });
    for (const id of ["start","pause","camera","result","result-title","result-detail","fixture","qr","offline","counts","startup-error"]) elements.set(id,node());
    Object.assign(elements.get("camera"),{ readyState:2,videoWidth:size,videoHeight:size,play:async () => {} });
    const requests=[];
    const context={
      document:{ hidden:false,getElementById:id => elements.get(id),addEventListener() {},
        createElement:tag => tag === "canvas" ? { width:0,height:0,getContext:() => ({ drawImage() {},clearRect() {},getImageData:() => ({ data:new Uint8ClampedArray(pixels),width:size,height:size }) }) } : node() },
      navigator:{ mediaDevices:{ getUserMedia:async () => ({ getTracks:() => [{ stop() { stopped++; } }] }) } },
      window:{ isSecureContext:true,addEventListener() {} },setTimeout,clearTimeout,
      fetch:async (url,options) => { requests.push(url); assert.equal(url,"/fixtures.json"); assert.equal(options.credentials,"omit"); return { ok:true,json:async () => ({ session }) }; },
    };
    new Script(built.secure.get("/bundle.js").body.toString()).runInNewContext(context);
    const tick=() => new Promise(resolve => setImmediate(resolve)); await tick();
    assert.equal(elements.get("start").disabled,false);
    await elements.get("start").events.get("click")(); await tick();
    assert.equal(elements.get("result-title").textContent,"Entrada validada"); assert.equal(stopped,1);
    assert.match(elements.get("result-detail").textContent,/simulada/);
    await elements.get("start").events.get("click")(); await tick();
    assert.equal(elements.get("result-title").textContent,"Entrada ya usada"); assert.equal(stopped,2);
    assert.deepEqual(requests,["/fixtures.json"]);
  });
  function request(path,changes={}) {
    const handle=handler({ host,mask,port:3443,files:built.secure });
    const request={ url:path,method:"GET",headers:{ host:`${host}:3443` },socket:{ remoteAddress:"192.168.1.90" },...changes };
    let status,headers,body;
    handle(request,{ writeHead(s,h) { status=s; headers=h; },end(b) { body=b; } });
    return { status,headers,body };
  }
  await t.test("exact allowlist denies APIs, config, traversal, queries and all writes without a proxy", () => {
    assert.equal(request("/").status,200); assert.equal(request("/bundle.js").status,200);
    assert.equal(request("/",{ method:"HEAD" }).body,undefined);
    for (const path of ["/api/door-scan","/admin","/.env.local","/server.key.pem","/../package.json","/%2e%2e/package.json","/?token=synthetic","http://localhost:3000/"]) assert.equal(request(path).status,404);
    for (const method of ["POST","PUT","PATCH","DELETE","OPTIONS"]) assert.equal(request("/",{ method }).status,405);
    assert.match(request("/").headers["Content-Security-Policy"],/default-src 'none'/);
    assert.match(request("/").headers["Cache-Control"],/no-store/); assert.equal(request("/").headers["Set-Cookie"],undefined);
  });
  await t.test("private exact bind/peer subnet, Host and Origin protections ignore forwarding claims", () => {
    for (const ip of ["0.0.0.0","127.0.0.1","8.8.8.8","192.168.1.999","::1"]) assert.equal(privateIPv4(ip),false);
    assert.equal(sameSubnet("::ffff:192.168.1.90",host,mask),true);
    assert.equal(sameSubnet("192.168.2.90",host,mask),false);
    for (const peer of ["8.8.8.8","192.168.2.90"]) assert.equal(request("/",{ socket:{ remoteAddress:peer },headers:{ host:`${host}:3443`,"x-forwarded-for":"192.168.1.90" } }).status,403);
    for (const headers of [{ host:"example.invalid" },{ host:`${host}:3443`,origin:"https://example.invalid" }]) assert.equal(request("/",{ headers }).status,421);
  });
  await t.test("Node HTTPS verifies chain AND exact IP without disabling certificate verification", async () => {
    const server=createServer({ key:certificates.key,cert:certificates.cert,minVersion:"TLSv1.2" },(_req,res) => res.end("synthetic-only"));
    await new Promise(resolve => server.listen(0,"127.0.0.1",resolve));
    try {
      const output=await new Promise((resolve,reject) => {
        get({ host:"127.0.0.1",port:server.address().port,agent:false,ca:certificates.ca,checkServerIdentity:(_hostname,cert) => checkServerIdentity(host,cert) },res => {
          let body=""; res.on("data",part => { body+=part; }); res.on("end",() => resolve(body));
        }).on("error",reject);
      });
      assert.equal(output,"synthetic-only");
      await assert.rejects(new Promise((resolve,reject) => {
        get({ host:"127.0.0.1",port:server.address().port,agent:false,ca:certificates.ca,checkServerIdentity:(_hostname,cert) => checkServerIdentity("192.168.1.99",cert) },resolve).on("error",reject);
      }),{ code:"ERR_TLS_CERT_ALTNAME_INVALID" });
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});
