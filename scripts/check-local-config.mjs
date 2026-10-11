import { hasDevelopmentClerkKeys } from "../lib/local-access.ts";

// Inspect only readiness. Never print a key, user identifier or parsed issuer.
if (!hasDevelopmentClerkKeys(process.env)) {
  console.error("Configuration pending: enter both owned Development keys privately in web/.env.local.");
  process.exitCode = 1;
} else {
  console.log("Development key formats present. Real local sign-in is still required to verify the connection.");
}
