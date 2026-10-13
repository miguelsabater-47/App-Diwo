import assert from "node:assert/strict";
import { test, after } from "node:test";
import { registerHooks, createRequire } from "node:module";
import QRCode from "qrcode";

// Use the actual reader and role policy, replacing only the signed transport.
const root = new URL("../", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier === "@/lib/supabase-session") return {
      url: "data:text/javascript,export async function createSessionSupabaseClient(){return globalThis.ticketSession}",
      shortCircuit: true,
    };
    if (specifier.startsWith("@/lib/")) return {
      url: new URL(specifier.slice(2) + ".ts", root).href, shortCircuit: true,
    };
    return next(specifier, context);
  },
});
const { readOwnedTicket } = await import("../lib/owned-ticket-reader.ts");
const { renderOwnedTicketQr } = await import("../lib/owned-ticket-qr.ts");
after(() => { hook.deregister(); delete globalThis.ticketSession; });

const id = "9d560641-aacf-4d25-8d65-94960bba59b2";
const stamp = "2026-10-31T22:00:00Z";
const token = "abcdef0123456789".repeat(4);
const row = {
  id, order_id: id, event_id: id, attendee_name: "Guest", status: "valid",
  issued_at: stamp, used_at: null, revoked_at: null, qr_token: token,
  event_slug: "diwo-technical-test-20261012", event_title: "Technical",
  starts_at: stamp, ends_at: "2026-11-01T06:00:00Z", timezone: "Europe/Madrid",
  public_location: "Evento ficticio de integración", unit_price_cents: 500,
  currency: "EUR", order_reference: "DIWO-TEST",
};
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_probe";
process.env.CLERK_SECRET_KEY = "sk_test_probe";

function mock(rows, roles = ["user", "user"]) {
  const calls = [];
  globalThis.ticketSession = {
    status: "ready",
    client: { rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: name === "get_current_app_role" ? roles.shift() : rows, error: null };
    } },
  };
  return calls;
}

test("reader rechecks the current role and returns no raw bearer", async () => {
  const calls = mock([row]);
  const result = await readOwnedTicket(id);
  assert.equal(result.ok, true);
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.deepEqual(calls.map(call => call.name), ["get_current_app_role", "read_owned_ticket", "get_current_app_role"]);
  for (const rows of [[], [row, row], [{ ...row, id: "00000000-0000-4000-8000-000000000000" }]]) {
    mock(rows);
    assert.equal((await readOwnedTicket(id)).ok, false);
  }
  mock([row], ["user", "invalid"]);
  assert.equal((await readOwnedTicket(id)).ok, false);
  for (const status of ["used", "revoked"]) {
    mock([{ ...row, status, qr_token: null, [status === "used" ? "used_at" : "revoked_at"]: stamp }]);
    const history = await readOwnedTicket(id);
    assert.equal(history.ok, true);
    assert.equal(history.ticket.qrDataUrl, null);
  }
  globalThis.ticketSession = { status: "unauthenticated" };
  assert.deepEqual(await readOwnedTicket(id), { ok: false, status: 401, reason: "access" });
});

test("uppercase UUID reads exactly the same owned detail with a canonical RPC argument", async () => {
  mock([row]);
  const lowercase = await readOwnedTicket(id);
  const calls = mock([row]);
  const uppercase = await readOwnedTicket(id.toUpperCase());
  assert.equal(uppercase.ok, true);
  assert.deepEqual(uppercase, lowercase);
  assert.equal(calls.find(call => call.name === "read_owned_ticket").args.target_ticket, id);
});

test("local QR encodes the exact bearer and has a white quiet zone", async () => {
  const require = createRequire(import.meta.url);
  const encoded = QRCode.create(token, { errorCorrectionLevel: "M" });
  assert.equal(encoded.segments.map(segment => Buffer.from(segment.data).toString()).join(""), token);
  const png = require("pngjs").PNG.sync.read(Buffer.from((await renderOwnedTicketQr(token)).split(",")[1], "base64"));
  assert.equal(png.width, 640);
  assert.equal(png.height, 640);
  let black = 0;
  for (let y = 0; y < 640; y++) for (let x = 0; x < 640; x++) {
    const offset = (y * 640 + x) * 4;
    if (x < 40 || y < 40 || x >= 600 || y >= 600) {
      assert.deepEqual([...png.data.subarray(offset, offset + 4)], [255, 255, 255, 255]);
    }
    if (png.data[offset] === 0) black++;
  }
  assert.ok(black > 10000);
  for (const value of [null, "", token.toUpperCase(), token.slice(1), "https://example.test"]) {
    assert.equal(await renderOwnedTicketQr(value), null);
  }
  // Encoding and pixels are checked here; independent physical decoding is pending.
});
