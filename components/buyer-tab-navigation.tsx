"use client";

import { createContext, useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useRouter } from "next/navigation";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { isBuyerCachedPage, isBuyerFlowPage } from "@/lib/buyer-navigation";

export const BuyerTabPrefetch = createContext({ enabled: false, homeHref: "/" });
/** Scope cached navigation to the buyer flow, never QR/admin pages. */
export function BuyerTabNavigation({ enabled, children }: { enabled: boolean; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { isLoaded, userId, sessionId } = useAuth();
  const identity = useRef({ userId, sessionId });
  const reloading = useRef(false);
  const previousPath = useRef(pathname);
  const [pending, startTransition] = useTransition();
  const refreshObserved = useRef(false);
  const refreshing = useRef(false);
  // Follow React's current transition even when a fast refresh skips a pending
  // effect; also coalesce timer/visibility events before their next render.
  refreshing.current = pending;
  const [homeHref, setHomeHref] = useState("/");
  const changedIdentity = isLoaded && !!identity.current.sessionId &&
    (identity.current.sessionId !== sessionId || identity.current.userId !== userId);
  const authorizedSession = isLoaded && !!userId && !!sessionId && !changedIdentity && !reloading.current;
  const refresh = useCallback(() => {
    if (refreshing.current) return;
    refreshing.current = true;
    try { startTransition(() => router.refresh()); }
    catch { refreshing.current = false; }
  }, [router, startTransition]);

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
    // Next 15 seeds the initial dynamic URL as AUTO and does not upgrade that
    // full SSR entry to FULL: revisits reuse only loading.tsx. A per-document
    // buyer-only key gets a genuine FULL entry, including after a bookmarked
    // Home reload. It grants no access and contains no account/session identity.
    if (!enabled || !authorizedSession) { setHomeHref("/"); return; }
    const href = `/?_buyer_nav=${crypto.randomUUID()}`;
    setHomeHref(href);
    // Prepare Home while the first overview is visible, not only after the
    // user has already left it and immediately taps the return link.
    if (isBuyerCachedPage(previousPath.current) && previousPath.current !== "/request") {
      router.prefetch(href, { kind: PrefetchKind.FULL });
    }
  }, [enabled, authorizedSession, router]);

  useEffect(() => {
    const previous = previousPath.current;
    previousPath.current = pathname;
    if (!enabled || !authorizedSession || previous === pathname) return;
    if (pathname === "/request" || !isBuyerCachedPage(pathname)) return;
    // Ordinary overview/account navigation must retain the other prefetched
    // pages: router.refresh() clears the ENTIRE Router Cache in Next 15.
    if (isBuyerCachedPage(previous) && previous !== "/request") return;
    // Refresh once on return from request/payment or another non-cached flow.
    // Visibility revalidation and the personal overview timer keep data fresh.
    refresh();
  }, [pathname, enabled, authorizedSession, refresh]);

  useEffect(() => {
    if (pending) { refreshObserved.current = true; return; }
    if (!refreshObserved.current) return;
    refreshObserved.current = false;
    if (!enabled || !authorizedSession || !isBuyerFlowPage(pathname) || pathname === "/request") return;
    // The necessary refresh discards earlier preloads. Warm the other overviews
    // AFTER it settles, not during the refresh or on every tab transition.
    // Next 15's typed FULL kind includes dynamic data, unlike shell-only AUTO.
    for (const path of ["/", "/ticket", "/account"]) {
      if (path !== pathname) router.prefetch(path === "/" ? homeHref : path, { kind: PrefetchKind.FULL });
    }
  }, [pending, enabled, authorizedSession, pathname, router, homeHref]);

  useEffect(() => {
    // Never refresh an editable request automatically. Submission still checks
    // live sales availability on the server; preloading is strictly read-only.
    if (!enabled || !authorizedSession || !isBuyerFlowPage(pathname) || pathname === "/request") return;
    const revalidate = () => {
      if (!document.hidden && navigator.onLine !== false && !pending) refresh();
    };
    document.addEventListener("visibilitychange", revalidate);
    return () => document.removeEventListener("visibilitychange", revalidate);
  }, [enabled, authorizedSession, pathname, pending, refresh]);

  useEffect(() => {
    // Personal overview only, including admin/staff using buyer features. No
    // initial duplicate read, QR polling, preview polling or automatic writes.
    if (!authorizedSession || !/^\/ticket\/?$/.test(pathname) || pending) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      if (!disposed && !document.hidden && navigator.onLine !== false) refresh();
    }, 30000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [authorizedSession, pathname, pending, refresh]);

  if (changedIdentity || reloading.current) return <main role="status" className="p-6">
    Actualizando sesión… <button type="button" onClick={() => window.location.reload()}>Recargar</button>
  </main>;

  // Toggling false -> true after refresh re-arms the visible Links' native full
  // prefetch without remounting the navigation or stealing keyboard focus.
  return <BuyerTabPrefetch.Provider value={{
    enabled: enabled && authorizedSession && isBuyerFlowPage(pathname) && !pending,
    homeHref: enabled && authorizedSession ? homeHref : "/",
  }}>
    {children}
  </BuyerTabPrefetch.Provider>;
}
