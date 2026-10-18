/** Synthetic browser-memory model ONLY. No real token format, persistence or I/O. */
export const rehearsalCases = ["valid", "revoked", "wrong_event", "unknown"] as const;
export type RehearsalCase = typeof rehearsalCases[number];
export type RehearsalOutcome = "admitted" | "already_used" | "revoked" | "wrong_event" | "unknown" | "connection_error";
export type RehearsalReceipt = { outcome: RehearsalOutcome; usedAt: string | null };
export const rehearsalLabels: Record<RehearsalCase, string> = {
  valid: "A · Entrada ficticia válida", revoked: "B · Entrada ficticia anulada", wrong_event: "C · Otro evento ficticio", unknown: "D · QR desconocido ficticio",
};
export function createScanRehearsal(sessionId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) throw new Error("invalid_rehearsal_session");
  const fixtures = rehearsalCases.map(kind => ({ kind, label: rehearsalLabels[kind], token: `DIWO-REHEARSAL-v1:${sessionId}:${kind}` }));
  let firstUse: string | null = null;
  return {
    fixtures,
    counts: () => ({ used: firstUse ? 1 : 0, pending: firstUse ? 0 : 1, total: 1 }),
    read(token: string, online = true): RehearsalReceipt {
      if (!online) return { outcome: "connection_error", usedAt: null };
      const kind = fixtures.find(f => f.token === token)?.kind;
      if (kind === "valid") {
        if (firstUse) return { outcome: "already_used", usedAt: firstUse };
        firstUse = new Date().toISOString();
        return { outcome: "admitted", usedAt: firstUse };
      }
      return { outcome: kind === "revoked" || kind === "wrong_event" ? kind : "unknown", usedAt: null };
    },
  };
}
