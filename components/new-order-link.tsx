"use client";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { parseRequestDraft } from "@/lib/order-request-state";

/** Clear only an acknowledged owned submission, on this explicit new-order gesture. */
export function NewOrderLink({ eventId, knownOrderIds }: { eventId: string | null; knownOrderIds: string[] }) {
  const { userId } = useAuth();
  const router = useRouter();
  function start() {
    if (userId && eventId) {
      try {
        const key = `diwo.order-submission.v1.${userId}.${eventId}`;
        const raw = sessionStorage.getItem(key);
        const previous = raw ? parseRequestDraft(raw, eventId) : null;
        if (previous && knownOrderIds.includes(previous.requestId)) sessionStorage.removeItem(key);
      } catch { /* Keep uncertain submission; request screen will fail closed. */ }
    }
    router.push("/request");
  }
  return <Button type="button" variant="outline" className="mt-6 min-h-12 w-full" onClick={start}>Solicitar más entradas</Button>;
}
