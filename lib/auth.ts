// lib/auth.ts
import type { User } from "@clerk/nextjs/server";

export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  const role = (user.publicMetadata as Record<string, unknown>)?.role;
  return role === "admin";
}
