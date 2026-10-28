// Loopback prototype data only. No database, credentials, auth or QR dependency.
const eventId = "99233d64-f779-4a4b-8f7e-634a5ee4ed94";
export function createPreviewTransport(eventControl) {
  const event = { id: eventId, title: "DIWO X 2.0", timezone: "Europe/Madrid", starts_at: "2026-10-31T22:30Z", ends_at: "2026-11-01T06:00Z" };
  const names = ["Alejandro García", "María López", "Pablo Martínez", "Lucía Fernández", "Diego Ruiz", "Elena Sánchez", "Carlos Romero", "Ana Torres", "Álex García", "Marta Navarro"];
  const rows = Array.from({ length: 142 }, (_, i) => ({ id: `5ba7d710-cb52-4053-8b7e-${String(i+1).padStart(12,"0")}`, event_id: eventId,
    order_id: eventId, ticket_position: i+1, orders: { reference: "A7K2", status: "confirmed" }, attendee_name: names[i%10],
    status: i<95 ? "used" : i>=140 ? "revoked" : "valid", used_at: i<95 ? new Date(Date.parse("2026-11-01T00:42Z")-i*60000).toISOString() : null }));
  const streams = new Set(); let clock = Date.parse("2026-11-01T01:00Z");
  const send = () => { for (const res of streams) res.write("event: changed\ndata: {}\n\n"); };
  const reply = (res, status, data) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  return async function transport(req, res, url) {
    if (url.pathname === "/signals" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.write(": connected\n\n"); streams.add(res);
      const heartbeat = setInterval(() => res.write(": heartbeat\n\n"), 15000); heartbeat.unref();
      req.on("close", () => { streams.delete(res); clearInterval(heartbeat); }); return true;
    }
    if (url.pathname === "/snapshot" && req.method === "GET") {
      const q = url.searchParams.get("q") ?? "", p = url.searchParams.get("page") ?? "0";
      if (q.length>120 || !/^\d{1,5}$/.test(p)) reply(res,400,{error:"invalid_query"});
      else reply(res,200,eventControl(event,rows,q,Number(p),new Date("2026-11-01T01:00Z")));
      return true;
    }
    if (url.pathname === "/admit" && req.method === "POST") {
      if (req.headers.origin !== url.origin || req.headers["sec-fetch-site"] === "cross-site") { reply(res,403,{error:"invalid_origin"}); return true; }
      let body = "";
      for await (const chunk of req) { body += chunk; if (body.length>512) { reply(res,413,{error:"invalid_request"}); return true; } }
      let input; try { input=JSON.parse(body); } catch { reply(res,400,{error:"invalid_request"}); return true; }
      const row = input.eventId===eventId ? rows.find(r=>r.id===input.ticketId) : null;
      if (!row) { reply(res,200,{result:{outcome:"unknown",ticketId:null,name:null,usedAt:null}}); return true; }
      const outcome = row.status === "valid" ? "admitted" : row.status === "used" ? "already_used" : "revoked";
      if (outcome === "admitted") { row.status="used"; row.used_at=new Date(clock+=1000).toISOString(); send(); }
      reply(res,200,{result:{outcome,ticketId:row.id,name:row.attendee_name,usedAt:row.used_at}}); return true;
    }
    return false;
  };
}
