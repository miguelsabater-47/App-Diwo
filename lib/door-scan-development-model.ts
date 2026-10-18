import type { DoorEvent, ScanResult } from "./door-scan-model";

export type DoorScanDevelopmentOutcome = "admitted" | "already_used" | "revoked" | "unknown" | "connection_error";
export type DoorScanDevelopmentConfig = { enabled: boolean; outcome: DoorScanDevelopmentOutcome };
export type DoorScanDevelopmentState = { event: DoorEvent; result: ScanResult | null; connectionError: boolean };
type Context = { nodeEnv?: string; host: string | null; developmentKeys: boolean; localOrigin: boolean; role: string };

/** Presentation data only. Never issues a ticket, produces a QR or calls an API. */
export function createDoorScanDevelopmentState(config: DoorScanDevelopmentConfig, context: Context): DoorScanDevelopmentState | null {
  if (!config.enabled || context.nodeEnv !== "development" || context.host !== "localhost:3000" ||
      !context.developmentKeys || !context.localOrigin || !["admin", "door_staff"].includes(context.role) ||
      !["admitted", "already_used", "revoked", "unknown", "connection_error"].includes(config.outcome)) return null;
  const used = config.outcome === "admitted" || config.outcome === "already_used";
  return {
    event: { id: "d1700000-0000-4000-8000-000000000001", title: "DIWO CLUB", used: used ? 1 : 0, pending: used ? 2 : 3, total: 3 },
    result: config.outcome === "connection_error" ? null : config.outcome === "unknown" ? {
      outcome: "unknown", ticketId: null, name: null, usedAt: null,
    } : {
      outcome: config.outcome, ticketId: "d1700000-0000-4000-8000-000000000002", name: "Javier López Martínez",
      usedAt: used ? "2026-10-31T23:42:18Z" : null,
    },
    connectionError: config.outcome === "connection_error",
  };
}
