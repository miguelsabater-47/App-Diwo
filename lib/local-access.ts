type RuntimeEnv = Record<string, string | undefined>;

/** Explicit canonical origin, never inferred from Host/forwarded headers or preview URLs. */
export function configuredAppOrigin(env: RuntimeEnv): string | null {
  if (env.VERCEL_ENV && env.VERCEL_ENV !== "production") return null;
  if (!env.DIWO_APP_ENV || env.DIWO_APP_ENV === "development") {
    if (env.VERCEL || env.VERCEL_ENV || (env.DIWO_APP_ORIGIN && env.DIWO_APP_ORIGIN !== "http://localhost:3000")) return null;
    return "http://localhost:3000";
  }
  if (env.DIWO_APP_ENV !== "production" || env.NODE_ENV !== "production" ||
      (env.VERCEL && env.VERCEL_ENV !== "production")) return null;
  try {
    const url = new URL(env.DIWO_APP_ORIGIN ?? "");
    const host = url.hostname;
    if (url.protocol !== "https:" || url.origin !== env.DIWO_APP_ORIGIN || url.port ||
        !host.includes(".") || !/^[a-z0-9.-]+$/.test(host) ||
        host.split(".").some(label => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) ||
        /^[\d.]+$/.test(host) || /(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host) ||
        host.endsWith(".vercel.app")) return null;
    return url.origin;
  } catch { return null; }
}

/** Local diagnostic/rehearsal helper remains Development-only. */
export function hasDevelopmentClerkKeys(
  env: Record<string, string | undefined>,
): boolean {
  const publicKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const secretKey = env.CLERK_SECRET_KEY;
  return Boolean(
    publicKey &&
      secretKey &&
      publicKey === publicKey.trim() &&
      secretKey === secretKey.trim() &&
      /^pk_test_[A-Za-z0-9+/=_-]+$/.test(publicKey) &&
      /^sk_test_[A-Za-z0-9_-]+$/.test(secretKey),
  );
}

/** Production must be explicit and uses a matched live pair, never Development keys. */
export function hasConfiguredClerkKeys(env: RuntimeEnv): boolean {
  if (!configuredAppOrigin(env)) return false;
  if (env.DIWO_APP_ENV !== "production") return hasDevelopmentClerkKeys(env);
  const publicKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "", secretKey = env.CLERK_SECRET_KEY ?? "";
  return publicKey === publicKey.trim() && secretKey === secretKey.trim() &&
    /^pk_live_[A-Za-z0-9+/=_-]+$/.test(publicKey) && /^sk_live_[A-Za-z0-9_-]+$/.test(secretKey);
}

/** Explicit server-side Production pin; no automatic destination or scanner sandbox. */
export function configuredSupabaseUrl(env: RuntimeEnv): string | null {
  if (!configuredAppOrigin(env)) return null;
  const development = "https://dujltrbvytsnftlfitbd.supabase.co";
  if (env.DIWO_APP_ENV !== "production") return development;
  const target = env.DIWO_PRODUCTION_SUPABASE_URL;
  if (!target || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(target) ||
      target === "https://ofqywrjvzolmoqimkngt.supabase.co") return null;
  return target;
}

/** Visual-only payment prototype is never a customer/hosted entry point. */
export function isLocalPaymentPreview(env: RuntimeEnv): boolean {
  return env.NODE_ENV === "development" && configuredAppOrigin(env) === "http://localhost:3000" && hasDevelopmentClerkKeys(env);
}

function matchesPath(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** No authorization is inferred from email or editable Clerk metadata. */
export function isPrivilegedPath(pathname: string): boolean {
  return ["/admin", "/api/admin", "/scan"].some((base) =>
    matchesPath(pathname, base),
  );
}

/** Only these new pages have independent server/current-DB-role gates. */
export function isConfiguredOrderAdminPage(pathname: string): boolean {
  return ["/admin", "/admin/", "/admin/requests", "/admin/requests/", "/admin/scan", "/admin/scan/", "/admin/staff", "/admin/staff/", "/admin/tickets", "/admin/tickets/"].includes(pathname);
}

/** Only the new current-admin readers/mutation; never unlock legacy admin APIs. */
export function isConfiguredExtraTicketApi(pathname: string): boolean {
  return /^\/api\/admin\/extra-tickets(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})?\/?$/i.test(pathname);
}

/** Exact scanner page only. Descendants and legacy redemption stay blocked. */
export function isConfiguredDoorPage(pathname: string): boolean {
  return pathname === "/scan" || pathname === "/scan/";
}

/** Local rehearsal only: never grants access to /scan children or admin APIs. */
export function isLocalScanRehearsal(pathname: string, origin: string, env: Record<string, string | undefined>): boolean {
  return ["/admin/scan-rehearsal", "/admin/scan-rehearsal/"].includes(pathname) &&
    origin === "http://localhost:3000" && configuredAppOrigin(env) === origin &&
    env.NODE_ENV === "development" && hasDevelopmentClerkKeys(env);
}

export function isLegacyRedemptionPath(pathname: string): boolean {
  return matchesPath(pathname, "/api/redeem");
}
