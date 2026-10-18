import "server-only";
import { headers } from "next/headers";
import { configuredAppOrigin, hasDevelopmentClerkKeys } from "./local-access";
import { doorScanDevelopmentConfig } from "./door-scan-development-config";
import { createDoorScanDevelopmentState } from "./door-scan-development-model";

/** Called only after the page's current-role authorization, never from a query parameter. */
export async function getDoorScanDevelopmentState(role: string) {
  if (process.env.NODE_ENV !== "development" || !doorScanDevelopmentConfig.enabled) return null;
  return createDoorScanDevelopmentState(doorScanDevelopmentConfig, {
    nodeEnv: process.env.NODE_ENV,
    host: (await headers()).get("host"),
    developmentKeys: hasDevelopmentClerkKeys(process.env),
    localOrigin: configuredAppOrigin(process.env) === "http://localhost:3000",
    role,
  });
}
