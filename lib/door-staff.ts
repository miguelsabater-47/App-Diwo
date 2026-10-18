import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { hasConfiguredClerkKeys, configuredAppOrigin } from "@/lib/local-access";
import { createSessionSupabaseClient } from "@/lib/supabase-session";
import { readCurrentAppAccess } from "@/lib/app-authorization-core";
import { handleDoorStaff, type StaffDirectory } from "@/lib/door-staff-core";

const directory: StaffDirectory = {
  async byEmail(email) {
    const clerk = await clerkClient();
    return clerk.users.getUserList({ emailAddress: [email], limit: 2 });
  },
  async byIds(ids) {
    const clerk = await clerkClient();
    const result = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const found = await clerk.users.getUserList({ userId: ids.slice(offset, offset + 100), limit: 100 });
      // Missing/deleted accounts are displayed as unavailable, still revocable.
      if (found.totalCount !== found.data.length) throw new Error("staff_directory_incomplete");
      result.push(...found.data);
    }
    return result;
  },
};

export function runDoorStaff(request: Request) {
  return handleDoorStaff(request, {
    origin: configuredAppOrigin(process.env),
    directory,
    async authorize() {
      if (!hasConfiguredClerkKeys(process.env)) return { ok: false, status: 503, reason: "local_configuration_required" };
      const session = await createSessionSupabaseClient();
      const access = await readCurrentAppAccess(async () => session);
      if (!access.ok) return access;
      if (session.status !== "ready") return { ok: false, status: 502, reason: "supabase_session_verification_failed" };
      return { ok: true, role: access.role, client: session.client };
    },
  });
}
