import { createClient } from "@supabase/supabase-js";

/** Invalidation only: never subscribe to ticket/order rows or send attendee data. */
export function subscribeEventControl(eventId: string, getToken: () => Promise<string | null>, changed: () => void) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(url) || !key || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return () => {};
  let disposed = false;
  const client = createClient(url, key, {
    accessToken: async () => { const token = await getToken(); if (!token) throw new Error("session_unavailable"); return token; },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const channel = client.channel(`diwo:event:${eventId}`, { config: { private: true } })
    .on("broadcast", { event: "changed" }, () => { if (!disposed) changed(); });
  const connect = async () => {
    try {
      await client.realtime.setAuth();
      if (!disposed) channel.subscribe(status => { if (!disposed && status === "SUBSCRIBED") changed(); });
    } catch { /* Bounded HTTP reconciliation remains available if Realtime fails. */ }
  };
  void connect();
  // Refresh Clerk's short-lived JWT for Realtime as well as each HTTP read.
  const renewal = setInterval(() => { if (!disposed) void client.realtime.setAuth().catch(() => {}); }, 30000);
  return () => { disposed = true; clearInterval(renewal); void client.removeChannel(channel); };
}
