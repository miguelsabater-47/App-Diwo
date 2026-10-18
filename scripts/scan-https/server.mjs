import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { generateKeyPairSync, randomBytes, randomUUID, X509Certificate } from "node:crypto";
import { networkInterfaces } from "node:os";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import forge from "node-forge";
import ts from "typescript";
import QRCode from "qrcode";

const require = createRequire(import.meta.url);
export function privateIPv4(ip) {
  if (typeof ip !== "string" || !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split(".").some(n => Number(n)>255)) return false;
  const [a,b]=ip.split(".").map(Number);
  return a===10 || (a===172 && b>=16 && b<=31) || (a===192 && b===168);
}
function numeric(ip) { return ip.split(".").reduce((n,part) => ((n<<8) | Number(part))>>>0,0); }
export function sameSubnet(peer,host,mask) {
  peer=peer?.replace(/^::ffff:/,"");
  return privateIPv4(peer) && ((numeric(peer)&numeric(mask))>>>0)===((numeric(host)&numeric(mask))>>>0);
}
export function createCertificates(host, now = new Date()) {
  if (!privateIPv4(host)) throw new Error("private_lan_address_required");
  const { pki }=forge;
  const keys=() => {
    const pair=generateKeyPairSync("rsa",{ modulusLength:2048,publicKeyEncoding:{ type:"spki",format:"pem" },privateKeyEncoding:{ type:"pkcs1",format:"pem" } });
    return { publicKey:pki.publicKeyFromPem(pair.publicKey),privateKey:pki.privateKeyFromPem(pair.privateKey),pem:pair.privateKey };
  };
  const rootKeys=keys(),serverKeys=keys(),root=pki.createCertificate(),leaf=pki.createCertificate();
  const name=`DIWO ensayo temporal ${now.toISOString().replace(/[^0-9]/g,"").slice(0,14)}`;
  for (const cert of [root,leaf]) {
    cert.serialNumber=`01${randomBytes(15).toString("hex")}`;
    cert.validity.notBefore=new Date(now.getTime()-300000);
    cert.validity.notAfter=new Date(now.getTime()+86400000);
  }
  root.publicKey=rootKeys.publicKey;
  root.setSubject([{ name:"commonName",value:name }]); root.setIssuer(root.subject.attributes);
  root.setExtensions([{ name:"basicConstraints",critical:true,cA:true,pathLenConstraint:0 },{ name:"keyUsage",critical:true,keyCertSign:true,cRLSign:true },{ name:"subjectKeyIdentifier" }]);
  root.sign(rootKeys.privateKey,forge.md.sha256.create());
  leaf.publicKey=serverKeys.publicKey; leaf.setSubject([{ name:"commonName",value:host }]); leaf.setIssuer(root.subject.attributes);
  leaf.setExtensions([{ name:"basicConstraints",critical:true,cA:false },{ name:"keyUsage",critical:true,digitalSignature:true,keyEncipherment:true },{ name:"extKeyUsage",serverAuth:true },{ name:"subjectAltName",altNames:[{ type:7,ip:host }] },{ name:"subjectKeyIdentifier" }]);
  leaf.sign(rootKeys.privateKey,forge.md.sha256.create());
  const ca=pki.certificateToPem(root),cert=pki.certificateToPem(leaf),publicCertificate=new X509Certificate(ca);
  // No private key files, trust-store operations or persisted CA signing key.
  return { key:serverKeys.pem,cert,ca,der:publicCertificate.raw,name,fingerprint:publicCertificate.fingerprint256,expires:root.validity.notAfter.toISOString() };
}
export async function browserBundle() {
  // Fixed allowlist only: never walk the application tree or ship environment/config.
  const files={
    "qr-frame-reader":"../../lib/qr-frame-reader.ts",
    "door-camera-session":"../../lib/door-camera-session.ts",
    "scan-rehearsal":"../../lib/scan-rehearsal.ts",
    "door-scan-feedback":"../../lib/door-scan-feedback.ts",
    client:"./client.ts",
  };
  const modules=[];
  for (const [id,file] of Object.entries(files)) {
    const code=ts.transpileModule(await readFile(new URL(file,import.meta.url),"utf8"),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true,sourceMap:false } }).outputText;
    modules.push(`${JSON.stringify(id)}:function(require,module,exports){\n${code}\n}`);
  }
  modules.push(`"jsqr":function(require,module,exports){\n${await readFile(require.resolve("jsqr"),"utf8")}\n}`);
  return `(()=>{"use strict";const modules={${modules.join(",\n")}},cache={};function load(name){const id=name.split("/").pop();if(!Object.prototype.hasOwnProperty.call(modules,id))throw Error("unknown_rehearsal_module");if(cache[id])return cache[id].exports;const mod={exports:{}};cache[id]=mod;modules[id](load,mod,mod.exports);return mod.exports;}load("client");})();`;
}
const css=`*{box-sizing:border-box}body{margin:0;background:#080808;color:#fff;font:16px system-ui,sans-serif;line-height:1.5}main{max-width:620px;margin:auto;padding:24px 20px 80px}section,aside,#result{border:1px solid #444;border-radius:16px;padding:18px;margin:20px 0}aside{border-color:#facc15}h1{font-size:28px;line-height:1.2}h2{font-size:22px}p{overflow-wrap:anywhere}small{color:#bbb}button,select,a.download{min-height:48px;width:100%;padding:12px;border-radius:10px;font:inherit;margin:8px 0}button{background:#fce921;color:#111;border:0;font-weight:700}button:disabled{opacity:.45}select{background:#161616;color:#fff;border:1px solid #777}button:focus-visible,select:focus-visible,a:focus-visible,input:focus-visible,#result:focus{outline:3px solid #fce921;outline-offset:4px}video{width:100%;max-height:50dvh;aspect-ratio:1;object-fit:cover;background:#000;border:1px solid #555;border-radius:12px}img{display:block;max-width:100%;width:320px;height:auto;margin:16px auto;background:#fff}a{color:#fce921}.success{background:#052e16;border-color:#22c55e!important}.rejected{background:#450a0a;border-color:#ef4444!important}.unconfirmed{border-color:#facc15!important}label{display:block;margin:12px 0}input{width:20px;height:20px;vertical-align:middle;margin-right:8px}[hidden]{display:none!important}`;
const head=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>DIWO · Ensayo HTTPS aislado</title><link rel="stylesheet" href="/style.css"></head><body><main>`;
export async function assets(host,certificates) {
  const session=randomUUID(),map=new Map();
  const add=(path,type,body) => map.set(path,{ type,body:Buffer.from(body) });
  add("/style.css","text/css; charset=utf-8",css);
  add("/fixtures.json","application/json; charset=utf-8",JSON.stringify({ session }));
  const kinds=["valid","revoked","wrong_event","unknown"],labels=["A · Válida ficticia","B · Anulada ficticia","C · Otro evento ficticio","D · Desconocido ficticio"];
  for (const kind of kinds) add(`/qr-${kind}.svg`,"image/svg+xml",await QRCode.toString(`DIWO-REHEARSAL-v1:${session}:${kind}`,{ type:"svg",margin:4,width:360 }));
  add("/bundle.js","text/javascript; charset=utf-8",await browserBundle());
  add("/","text/html; charset=utf-8",`${head}<h1>Ensayo de cámara · iPhone</h1><aside><strong>SIMULACIÓN LOCAL · No autoriza acceso real</strong><p>Sin Clerk, Supabase, cuentas, pagos ni entradas reales. No introduzcas credenciales. Los resultados y contadores solo existen en esta pestaña.</p><p>Escanea los QR ficticios que muestra el ordenador. Recargar reinicia la simulación, no una entrada real.</p></aside><p id="startup-error" role="alert" hidden></p><section><h2>Cámara</h2><video id="camera" muted playsinline aria-label="Cámara del ensayo"></video><label><input id="offline" type="checkbox">Simular fallo de conexión</label><button id="start" disabled>Abrir cámara del ensayo</button><button id="pause" disabled>Detener cámara</button><p id="counts">Simulado: usadas 0 · pendientes 1 · válidas 1</p></section><div id="result" role="status" aria-live="polite" tabindex="-1" hidden><strong>Solo ensayo · No autoriza acceso real</strong><h2 id="result-title"></h2><p id="result-detail"></p></div><section><h2>QR de esta sesión</h2><label for="fixture">Caso ficticio</label><select id="fixture"></select><img id="qr" alt="QR ficticio"><small>La misma sesión del servidor usa estos QR en el ordenador y el móvil. El estado simulado no se sincroniza entre dispositivos.</small></section><p>Al terminar: cierra esta pestaña y retira el certificado temporal del iPhone.</p></main><script src="/bundle.js" defer></script></body></html>`);
  const bootstrap=new Map();
  bootstrap.set("/style.css",map.get("/style.css"));
  bootstrap.set("/diwo-rehearsal-ca.cer",{ type:"application/x-x509-ca-cert",body:certificates.der });
  for (const kind of kinds) bootstrap.set(`/qr-${kind}.svg`,map.get(`/qr-${kind}.svg`));
  bootstrap.set("/",{ type:"text/html; charset=utf-8",body:Buffer.from(`${head}<h1>DIWO · Preparar ensayo HTTPS</h1><aside><strong>Solo prueba local ficticia</strong><p>Esta página HTTP no abre cámara, pide contraseñas ni accede a App Diwo. No hay proxy a localhost:3000.</p></aside><h2>Certificado temporal</h2><p>Nombre: ${certificates.name}</p><p>Caduca: ${certificates.expires}</p><p>SHA-256: ${certificates.fingerprint}</p><p><a href="/diwo-rehearsal-ca.cer">Descargar certificado público temporal</a></p><p>En el iPhone: instala únicamente este perfil y activa su confianza SSL. Verifica nombre y huella con el ordenador. No instala nada en Windows.</p><p>Después abre <a href="https://${host}:3443/">https://${host}:3443/</a> en Safari.</p><h2>QR ficticios para mostrar al iPhone</h2>${kinds.map((kind,i) => `<section><h3>${labels[i]}</h3><img src="/qr-${kind}.svg" alt="${labels[i]}"></section>`).join("")}<h2>Retirada</h2><p>Al acabar, elimina el perfil de certificado en Ajustes → General → VPN y gestión de dispositivos. El servidor se cierra automáticamente a las dos horas; también puedes cerrar su ventana con Ctrl+C.</p></main></body></html>`) });
  return { secure:map,bootstrap };
}
export function handler({ host,mask,port,files }) {
  return (request,response) => {
    const headers={ "Cache-Control":"no-store", "X-Content-Type-Options":"nosniff", "Referrer-Policy":"no-referrer",
      "Content-Security-Policy":"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; media-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "Permissions-Policy":"camera=(self), microphone=(), geolocation=()", "X-Frame-Options":"DENY" };
    function send(status,type,body) { response.writeHead(status,{ ...headers,"Content-Type":type }); response.end(request.method === "HEAD" ? undefined : body); }
    if (!sameSubnet(request.socket.remoteAddress,host,mask)) return send(403,"text/plain","Local subnet only");
    if (request.headers.host !== `${host}:${port}` || request.headers.origin && request.headers.origin !== `${port===3443 ? "https" : "http"}://${host}:${port}`) return send(421,"text/plain","Origin not allowed");
    if (!["GET","HEAD"].includes(request.method)) return send(405,"text/plain","Read only");
    const asset=files.get(request.url);
    if (!asset) return send(404,"text/plain","Not found");
    send(200,asset.type,asset.body);
  };
}
export async function startIsolatedRehearsal(host) {
  if (!privateIPv4(host)) throw new Error("private_lan_address_required");
  const nic=Object.values(networkInterfaces()).flat().find(n => n?.family==="IPv4" && n.address===host && !n.internal);
  if (!nic || nic.netmask==="0.0.0.0") throw new Error("local_network_interface_required");
  const certificates=createCertificates(host),built=await assets(host,certificates);
  const secure=httpsServer({ key:certificates.key,cert:certificates.cert,minVersion:"TLSv1.2",maxHeaderSize:8192 },handler({ host,mask:nic.netmask,port:3443,files:built.secure }));
  const bootstrap=httpServer({ maxHeaderSize:8192 },handler({ host,mask:nic.netmask,port:3080,files:built.bootstrap }));
  for (const server of [secure,bootstrap]) {
    server.maxConnections=16; server.headersTimeout=10000; server.requestTimeout=10000; server.keepAliveTimeout=5000;
    server.on("clientError",(_error,socket) => socket.destroy());
  }
  const listen=server => new Promise((resolve,reject) => { server.once("error",reject); server.listen(server===secure ? 3443 : 3080,host,resolve); });
  try { await listen(secure); await listen(bootstrap); } catch(error) { secure.close(); bootstrap.close(); throw error; }
  let timer;
  const stop=() => { clearTimeout(timer); for (const server of [secure,bootstrap]) { server.closeAllConnections(); server.close(); } };
  timer=setTimeout(stop,2*60*60*1000);
  return { certificates,stop };
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const args=process.argv.slice(2);
  if (args.length!==2 || args[0]!=="--host") { console.error("Usage: node scripts/scan-https/server.mjs --host <private LAN IPv4>"); process.exitCode=1; }
  else {
    try {
      const running=await startIsolatedRehearsal(args[1]);
      console.log(`Isolated synthetic rehearsal only. PID ${process.pid}. Auto-stop: 2 hours.`);
      console.log(`Certificate + PC QR samples: http://${args[1]}:3080/`);
      console.log(`iPhone camera after manual certificate trust: https://${args[1]}:3443/`);
      console.log(`Certificate: ${running.certificates.name}\nSHA-256: ${running.certificates.fingerprint}\nExpires: ${running.certificates.expires}`);
      for (const signal of ["SIGINT","SIGTERM"]) process.once(signal,running.stop);
    } catch { console.error("Isolated rehearsal could not start. No firewall, trust store or existing app service was changed."); process.exitCode=1; }
  }
}
