import { configuredAppOrigin, configuredSupabaseUrl, hasConfiguredClerkKeys } from "../lib/local-access.ts";

// Only format/presence checks on injected runtime config. No dotenv, network or logs of values.
const env = process.env;
const project = configuredSupabaseUrl(env);
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const checks = {
  explicit_production_mode: env.DIWO_APP_ENV === "production" && env.NODE_ENV === "production",
  canonical_https_origin: env.DIWO_APP_ENV === "production" && configuredAppOrigin(env) !== null,
  live_clerk_pair: env.DIWO_APP_ENV === "production" && hasConfiguredClerkKeys(env),
  explicit_supabase_pin: env.DIWO_APP_ENV === "production" && !!project && project === env.NEXT_PUBLIC_SUPABASE_URL,
  publishable_supabase_key: key === key.trim() && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key),
};
console.log("DIWO_PRODUCTION_CONFIG", checks);
if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
else console.log("Formats only: hosted auth, current admin identity, schema, domain, event and payment details still require separate activation.");
