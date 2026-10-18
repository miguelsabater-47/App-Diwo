import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { primaryVerifiedEmail } from "@/lib/admin-contact-model";

/** Caller must verify current DB admin immediately before AND after this lookup. */
export async function readAdminOrderContacts(subjects: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(subjects.filter(id => /^user_[A-Za-z0-9_-]+$/.test(id)))];
  const emails = new Map<string, string>();
  if (!ids.length) return emails;
  try {
    const clerk = await clerkClient();
    for (let start = 0; start < ids.length; start += 50) {
      const batch = ids.slice(start, start + 50);
      const users = await clerk.users.getUserList({ userId: batch, limit: 100 });
      for (const user of users.data) {
        if (!batch.includes(user.id)) continue;
        const email = primaryVerifiedEmail(user, user.id);
        if (email) emails.set(user.id, email);
      }
    }
  } catch { /* Contact availability is not payment proof and must not fabricate an email. */ }
  return emails;
}
