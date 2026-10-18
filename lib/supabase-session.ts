import "server-only";
import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { configuredSupabaseUrl, hasConfiguredClerkKeys } from "@/lib/local-access";

export async function createSessionSupabaseClient() {
  if (!hasConfiguredClerkKeys(process.env)) return { status: "configuration_required" } as const;
  const { userId, getToken } = await auth();
  if (!userId) return { status: "unauthenticated" } as const;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const projectUrl = configuredSupabaseUrl(process.env);
  if (!projectUrl || url !== projectUrl || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) {
    return { status: "configuration_required" } as const;
  }

  // Check that this request has a token; never fall back to an anonymous client.
  if (!(await getToken())) return { status: "unauthenticated" } as const;

  return {
    status: "ready",
    actorId: userId, // Internal server filter only; never include in a response DTO.
    client: createClient(url, key, {
      accessToken: async () => {
        const token = await getToken();
        if (!token) throw new Error("session_token_unavailable");
        return token;
      },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    }),
  } as const;
}
