"use client";

import { createContext, useEffect, useRef, useTransition } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { isBuyerCachedPage, isBuyerFlowPage } from "@/lib/buyer-navigation";

export const BuyerTabPrefetch = createContext(false);
/** Scope cached navigation to the buyer flow, never QR/admin pages. */
export function BuyerTabNavigation({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, userId, sessionId } = useAuth();
  const identity = useRef({ userId, sessionId });
  const reloading = useRef(false);
  const previousPath = useRef(pathname);
  const [pending, startTransition] = useTransition();
  const changedIdentity = isLoaded && !!identity.current.sessionId &&
    (identity.current.sessionId !== sessionId || identity.current.userId !== userId);
  const authorizedSession = isLoaded && !!userId && !!sessionId && !changedIdentity && !reloading.current;

  useEffect(() => {
    if (!isLoaded) return;
    if (!identity.current.sessionId && sessionId) identity.current = { userId, sessionId };
    if (changedIdentity && !reloading.current) {
      reloading.current = true;
      // A document navigation discards all prefetched RSC payloads, including
      // in-flight requests from the old account. Never reuse them for a new one.
      window.location.reload();
    }
  }, [changedIdentity, isLoaded, userId, sessionId]);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (!enabled || !authorizedSession || previous === pathname) return;
    if (pathname === "/request" || !isBuyerCachedPage(pathname)) return;
    // Keep the prefetched view visible while checking current server data.
    // Returning from request/payment also invalidates old overview payloads.
    startTransition(() => router.refresh());
  }, [pathname, enabled, authorizedSession, router, startTransition]);

  useEffect(() => {
    // Never refresh an editable request automatically. Submission still checks
    // live sales availability on the server; preloading is strictly read-only.
    if (!enabled || !authorizedSession || !isBuyerFlowPage(pathname) || pathname === "/request") return;
    const revalidate = () => {
      if (!document.hidden && !pending) startTransition(() => router.refresh());
    };
    document.addEventListener("visibilitychange", revalidate);
    return () => document.removeEventListener("visibilitychange", revalidate);
  }, [enabled, authorizedSession, pathname, pending, router, startTransition]);

  if (changedIdentity || reloading.current) return <main role="status" className="p-6">
    Actualizando sesión… <button type="button" onClick={() => window.location.reload()}>Recargar</button>
  </main>;

  // Toggling false -> true after refresh re-arms the visible Links' native full
  // prefetch without remounting the navigation or stealing keyboard focus.
  return <BuyerTabPrefetch.Provider value={enabled && authorizedSession && isBuyerFlowPage(pathname) && !pending}>
    {children}
  </BuyerTabPrefetch.Provider>;
}
