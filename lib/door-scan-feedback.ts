import type { ScanResult } from "./door-scan-model";

export type ScanFeedback = { title: string; detail: string; tone: "success" | "rejected" | "unconfirmed" };
/** Presentation only: keep authoritative outcomes and access rules unchanged. */
export function scanFeedback(outcome: ScanResult["outcome"] | "connection_error"): ScanFeedback {
  switch (outcome) {
    case "admitted": return { title: "Entrada validada", detail: "Acceso registrado. Puedes dejar pasar.", tone: "success" };
    case "already_used": return { title: "Entrada ya usada", detail: "Acceso rechazado. No se permite reentrada.", tone: "rejected" };
    case "revoked":
    case "wrong_event":
    case "unknown": return { title: "Entrada no válida", detail: "No autorices el acceso. Revisa la entrada.", tone: "rejected" };
    case "connection_error": return { title: "No se ha podido comprobar", detail: "No autorices el acceso. El resultado no está confirmado.", tone: "unconfirmed" };
  }
}
export function scanFeedbackStyle(tone: ScanFeedback["tone"]): string {
  if (tone === "success") return "border-green-500 bg-green-950";
  if (tone === "rejected") return "border-red-500 bg-red-950";
  return "border-amber-500 bg-zinc-950";
}
