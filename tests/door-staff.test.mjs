import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
import * as model from "../lib/door-staff-model.ts";

const compiled = ts.transpileModule(readFileSync(new URL("../lib/door-staff-core.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
new Function("require", "module", "exports", compiled)(name => name === "node:crypto" ? { createHash } : model, mod, mod.exports);
const { handleDoorStaff, staffReference } = mod.exports;
const subject = "user_synthetic_target", id = staffReference(subject), at = "2026-10-15T20:00:00.123456+00:00";
const account = () => ({ id: subject, firstName: "Synthetic", lastName: "Person", primaryEmailAddressId: "email_fixture", banned: false, locked: false,
  emailAddresses: [{ id: "email_fixture", emailAddress: "person@example.invalid", verification: { status: "verified" } }] });
function fixture(overrides = {}) {
  const calls = [], directoryCalls = [], user = account();
  const state = { role: "admin", nextRole: "admin", rows: [], targetRole: "user", targetVersion: null, users: [user], count: 1, error: null, ...overrides };
  const client = { async rpc(name, args) {
    calls.push({ name, args });
    if (state.error) return { data: null, error: state.error };
    if (name === "get_current_app_role") return { data: state.nextRole, error: null };
    if (name === "list_door_staff") return { data: state.rows, error: null };
    const app_role = name === "grant_door_staff" ? "door_staff" : name === "revoke_door_staff" ? "user" : state.targetRole;
    return { data: state.receipt ?? [{ staff_id: id, app_role, version: name === "read_staff_target" ? state.targetVersion : at, clerk_subject: "private", qr_token: "private" }], error: null };
  } };
  const deps = {
    async authorize() { return state.denied ?? { ok: true, role: state.role, client }; },
    directory: {
      async byEmail(email) { directoryCalls.push({ email }); if (state.directoryThrows) throw Error("private upstream"); return { data: state.users, totalCount: state.count }; },
      async byIds(ids) { directoryCalls.push({ ids }); if (state.directoryThrows) throw Error("private upstream"); return state.users; },
    },
  };
  return { state, user, calls, directoryCalls, deps };
}
function request(body, options = {}) {
  return new Request("http://localhost:3000/api/door-staff", {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { origin: "http://localhost:3000", "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...options,
  });
}
async function error(response, status, reason) { assert.equal(response.status, status); assert.deepEqual(await response.json(), { error: reason }); }

test("lookup uses an exact verified directory identity and DB role, never metadata or a client subject", async () => {
  const f = fixture();
  const result = await handleDoorStaff(request({ action: "lookup", email: " Person@Example.Invalid " }), f.deps);
  assert.deepEqual(await result.json(), { candidate: { staffId: id, name: "Synthetic Person", email: "person@example.invalid", role: "user", version: null } });
  assert.deepEqual(f.directoryCalls, [{ email: "person@example.invalid" }]);
  assert.deepEqual(f.calls.map(c => c.name), ["read_staff_target", "get_current_app_role"]);
  assert.deepEqual(f.calls[0].args, { target_subject: subject });
  assert.ok(result.headers.get("cache-control").includes("no-store"));
});
test("lookup denies nonexistent, ambiguous, mismatched, unverified and blocked accounts", async () => {
  for (const [change, status, reason] of [
    [{ users: [], count: 0 }, 404, "registered_account_required"], [{ users: [account(), account()], count: 2 }, 409, "account_not_unique"],
    [{ users: [{ ...account(), emailAddresses: [] }] }, 502, "staff_directory_unavailable"],
    [{ users: [{ ...account(), emailAddresses: [{ id: "email_fixture", emailAddress: "person@example.invalid", verification: { status: "unverified" } }] }] }, 409, "verified_email_required"],
    [{ users: [{ ...account(), banned: true }] }, 409, "staff_account_unavailable"],
    [{ users: [{ ...account(), locked: true }] }, 409, "staff_account_unavailable"],
  ]) {
    const f = fixture(change);
    await error(await handleDoorStaff(request({ action: "lookup", email: "person@example.invalid" }), f.deps), status, reason);
    assert.equal(f.calls.length, 0);
  }
});
test("only current admin can enumerate, look up, assign or revoke; no directory calls before authorization", async () => {
  for (const role of ["user", "door_staff"]) for (const body of [undefined, { action: "lookup", email: "person@example.invalid" }, { action: "grant", email: "person@example.invalid", staffId: id, version: null }, { action: "revoke", staffId: id, version: at }]) {
    const f = fixture({ role });
    await error(await handleDoorStaff(request(body), f.deps), 403, "operation_not_authorized");
    assert.equal(f.calls.length + f.directoryCalls.length, 0);
  }
  const f = fixture({ denied: { ok: false, status: 401, reason: "authentication_required" } });
  await error(await handleDoorStaff(request(), f.deps), 401, "authentication_required");
});
test("assignment resolves identity again, binds preview reference and forwards only version and verified subject", async () => {
  const f = fixture();
  const body = { action: "grant", email: "person@example.invalid", staffId: id, version: null };
  assert.deepEqual(await (await handleDoorStaff(request(body), f.deps)).json(), { member: { staffId: id, role: "door_staff", version: at } });
  assert.deepEqual(f.calls, [{ name: "grant_door_staff", args: { target_subject: subject, expected_version: null } }]);
  const changed = fixture({ users: [{ ...account(), id: "user_reassigned_email" }] });
  await error(await handleDoorStaff(request(body), changed.deps), 409, "staff_account_changed");
  assert.equal(changed.calls.length, 0);
});
test("revocation uses the opaque DB identity, without requiring a still-available Clerk email/account", async () => {
  const f = fixture({ users: [], directoryThrows: true });
  assert.deepEqual(await (await handleDoorStaff(request({ action: "revoke", staffId: id, version: at }), f.deps)).json(), { member: { staffId: id, role: "user", version: at } });
  assert.equal(f.directoryCalls.length, 0);
  assert.deepEqual(f.calls[0], { name: "revoke_door_staff", args: { target_staff_id: id, expected_version: at } });
});
test("safe staff listing handles deleted identities and never projects subjects/private properties", async () => {
  const row = { staff_id: id, clerk_subject: subject, version: at, total_count: 1, raw: "private" };
  const f = fixture({ rows: [row] });
  assert.deepEqual(await (await handleDoorStaff(request(), f.deps)).json(), { staff: [{ staffId: id, name: "Synthetic Person", email: "person@example.invalid", version: at }] });
  const deleted = fixture({ rows: [row], users: [] });
  assert.deepEqual(await (await handleDoorStaff(request(), deleted.deps)).json(), { staff: [{ staffId: id, name: "Cuenta no disponible", email: null, version: at }] });
  const empty = fixture({ rows: [], users: [] });
  assert.deepEqual(await (await handleDoorStaff(request(), empty.deps)).json(), { staff: [] });
  assert.equal(empty.directoryCalls.length, 0);
  for (const rows of [[{ ...row, total_count: 2 }], [row, row], [{ ...row, staff_id: "f".repeat(64) }], [{ ...row, version: null }]]) {
    await error(await handleDoorStaff(request(), fixture({ rows }).deps), 502, "staff_operation_failed");
  }
});
test("database permission denial, protected admin, stale version and unknown errors fail without retry", async () => {
  for (const [upstream, status, reason] of [
    [{ code: "42501", message: "private" }, 403, "operation_not_authorized"],
    [{ code: "22023", message: "admin_identity_is_protected" }, 409, "admin_identity_is_protected"],
    [{ code: "22023", message: "staff_state_changed" }, 409, "staff_state_changed"],
    [{ code: "PGRST202", message: "private" }, 503, "staff_configuration_required"],
    [{ code: "UNKNOWN", message: "private" }, 502, "staff_operation_failed"],
  ]) {
    const f = fixture({ error: upstream });
    await error(await handleDoorStaff(request({ action: "revoke", staffId: id, version: at }), f.deps), status, reason);
    assert.equal(f.calls.length, 1);
  }
  await error(await handleDoorStaff(request(), fixture({ nextRole: "user" }).deps), 403, "operation_not_authorized");
});
test("strict schemas reject injected identities, role escalation, invalid versions and oversized byte streams", async () => {
  for (const body of [
    { action: "admin", email: "person@example.invalid" }, { action: "lookup", email: "person@example.invalid", clerkSubject: subject },
    { action: "grant", email: "person@example.invalid", staffId: id, version: null, role: "admin" },
    { action: "revoke", staffId: id, version: null }, { action: "lookup", email: "bad" },
  ]) {
    const f = fixture();
    await error(await handleDoorStaff(request(body), f.deps), 400, "invalid_staff_request");
    assert.equal(f.calls.length + f.directoryCalls.length, 0);
  }
  await error(await handleDoorStaff(request({ action: "lookup", email: "x".repeat(3000) }), fixture().deps), 413, "staff_request_too_large");
});
test("cross-origin/nonJSON requests fail before identity or role lookups", async () => {
  const f = fixture(); let authCalls = 0;
  f.deps.authorize = async () => { authCalls++; throw Error("must not authorize"); };
  for (const headers of [{ "content-type": "application/json" }, { origin: "https://attacker.invalid", "content-type": "application/json" }]) {
    await error(await handleDoorStaff(request({ action: "lookup" }, { headers }), f.deps), 403, "request_origin_not_allowed");
  }
  await error(await handleDoorStaff(request({}, { headers: { origin: "http://localhost:3000", "content-type": "text/plain" } }), f.deps), 415, "json_request_required");
  assert.equal(authCalls, 0);
});
test("models reject raw roles, wrong identities and malformed responses without weakening history/buyer roles", () => {
  const candidate = { staffId: id, email: "person@example.invalid", name: "Synthetic", role: "user", version: null };
  assert.deepEqual(model.staffCandidate(candidate, candidate.email), candidate);
  assert.equal(model.staffCandidate({ ...candidate, role: ["admin"] }, candidate.email), null);
  assert.equal(model.staffCandidate({ ...candidate, role: "admin" }, candidate.email), null);
  assert.equal(model.staffReceipt({ staffId: id, role: "admin", version: at }, id, "door_staff"), false);
  assert.equal(model.staffMembers([{ staffId: id, name: "Synthetic", email: null, version: at }]).length, 1);
});
