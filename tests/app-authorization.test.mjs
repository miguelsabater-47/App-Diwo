import assert from "node:assert/strict";
import { test } from "node:test";
import { readCurrentAppAccess, checkAllowedAppRole } from "../lib/app-authorization-core.ts";

const readySession = (rpc) => async () => ({ status: "ready", client: { rpc } });
const roleSession = (role) => readySession(async (name) => {
  assert.equal(name, "get_current_app_role");
  return { data: role, error: null };
});

test("role policy preserves buyer access and isolates administration and door access", async () => {
  for (const role of ["user", "door_staff", "admin"]) {
    const access = await readCurrentAppAccess(roleSession(role));
    assert.deepEqual(access, { ok: true, role });
    assert.equal(checkAllowedAppRole(access, ["user", "door_staff", "admin"]).ok, true);
    const admin = checkAllowedAppRole(access, ["admin"]);
    const door = checkAllowedAppRole(access, ["admin", "door_staff"]);
    assert.equal(admin.ok, role === "admin");
    assert.equal(door.ok, role !== "user");
    if (!admin.ok) assert.deepEqual(admin, { ok: false, status: 403, reason: "operation_not_authorized" });
    assert.equal(checkAllowedAppRole(access, []).ok, false);
  }
});

test("anonymous and incomplete configuration fail before any role lookup", async () => {
  for (const [status, expectedStatus, reason] of [
    ["unauthenticated", 401, "authentication_required"],
    ["configuration_required", 503, "supabase_configuration_required"],
  ]) {
    const access = await readCurrentAppAccess(async () => ({ status }));
    assert.deepEqual(access, { ok: false, status: expectedStatus, reason });
    assert.deepEqual(checkAllowedAppRole(access, ["admin"]), access);
  }
});

test("unknown roles and editable-metadata-shaped responses never grant privileges", async () => {
  for (const data of [null, undefined, "authenticated", "owner", "ADMIN", ["admin"],
    { role: "admin" }, { publicMetadata: { role: "admin" } }]) {
    const access = await readCurrentAppAccess(roleSession(data));
    assert.deepEqual(access, { ok: false, status: 502, reason: "supabase_session_verification_failed" });
    assert.equal(checkAllowedAppRole(access, ["admin", "door_staff"]).ok, false);
  }
});

test("upstream errors cannot leak data or grant access even with an admin payload", async () => {
  const fixtures = [
    readySession(async () => ({ data: "admin", error: { message: "synthetic-private-error" } })),
    readySession(async () => { throw new Error("synthetic-private-error"); }),
    async () => { throw new Error("synthetic-private-session-error"); },
  ];
  for (const createSession of fixtures) {
    const access = await readCurrentAppAccess(createSession);
    assert.deepEqual(access, { ok: false, status: 502, reason: "supabase_session_verification_failed" });
  }
});

test("revocation is visible on the next check with no retained role or client", async () => {
  let role = "door_staff";
  let sessions = 0;
  let lookups = 0;
  const createSession = async () => {
    sessions++;
    return { status: "ready", client: { rpc: async () => {
      lookups++;
      return { data: role, error: null };
    } } };
  };
  const before = await readCurrentAppAccess(createSession);
  assert.equal(checkAllowedAppRole(before, ["admin", "door_staff"]).ok, true);
  role = "user";
  const after = await readCurrentAppAccess(createSession);
  assert.deepEqual(checkAllowedAppRole(after, ["admin", "door_staff"]),
    { ok: false, status: 403, reason: "operation_not_authorized" });
  assert.equal(sessions, 2);
  assert.equal(lookups, 2);
});
