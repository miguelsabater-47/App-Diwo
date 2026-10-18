"use client";
import { useAuth } from "@clerk/nextjs";
import { BuyerFlowLink } from "@/components/buyer-flow-link";
import { Button } from "@/components/ui/button";
import { Ticket } from "lucide-react";
import { parseRequestDraft } from "@/lib/order-request-state";
import { matchesRecordedRequest, type RecordedRequest } from "@/lib/buyer-request-context";

/** Clear only an acknowledged owned submission, on this explicit new-order gesture. */
export function NewOrderLink({ eventId, recorded, label = "SOLICITAR MÁS ENTRADAS" }: { eventId: string | null; recorded: RecordedRequest[]; label?: string }) {
  const { userId } = useAuth();
  function start() {
    if (userId && eventId) {
      try {
        const key = `diwo.order-submission.v1.${userId}.${eventId}`;
        const raw = sessionStorage.getItem(key);
        const previous = raw ? parseRequestDraft(raw, eventId) : null;
        if (previous && matchesRecordedRequest(previous, recorded)) sessionStorage.removeItem(key);
      } catch { /* Keep uncertain submission; request screen will fail closed. */ }
    }
  }
  return <Button asChild className="diwo-home-cta"><BuyerFlowLink href="/request" onNavigate={start}>
    <Ticket aria-hidden="true" /><span>{label}</span>
  </BuyerFlowLink></Button>;
}
