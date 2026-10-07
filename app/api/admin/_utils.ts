import { auth, clerkClient } from "@clerk/nextjs/server";

export async function assertAdmin() {
  const { userId } = await auth();
  if (!userId) return { ok: false as const, status: 401, reason: "unauthorized" };
  const client = await clerkClient();
  const user = await client.users.getUser(userId);
  const priv = user.privateMetadata ?? {};
  const isAdmin =
    priv.isAdmin === true ||
    priv.isAdmin === "true" ||
    priv.role === "admin";
  if (!isAdmin) return { ok: false as const, status: 403, reason: "forbidden" };
  return { ok: true as const };
}
