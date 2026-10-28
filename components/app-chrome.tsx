"use client";

import { usePathname } from "next/navigation";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";
import AuthHeader from "@/components/auth-header";
import { AppNavigation, type NavigationRole } from "@/components/app-navigation";
import { isAuthScreen } from "@/lib/login-flow";
import { BuyerTabNavigation } from "@/components/buyer-tab-navigation";
import { PageMotion } from "@/components/page-motion";

/** Presentation only: server authorization and Clerk configuration stay upstream. */
export function AppChrome({ children, role = "user", soldOut = false, soldOutScreen, allowLocalExtrasPreview = false }: {
  children: React.ReactNode; role?: NavigationRole; soldOut?: boolean; soldOutScreen?: React.ReactNode; allowLocalExtrasPreview?: boolean;
}) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();
  const localExtrasPreview = allowLocalExtrasPreview && /^\/preview\/extra-tickets\/?$/.test(pathname);
  // The independent local prototype contains only fictional data and no real
  // actions. Its page separately checks the local-only environment boundary.
  if (localExtrasPreview) return <main>{children}</main>;
  // Keep the real application's session boundary mounted during auth transitions.
  const wrap = (content: React.ReactNode) => <BuyerTabNavigation enabled={!soldOut && !localExtrasPreview && (role === "user" || (role === "door_staff" && !["/door", "/scan", "/scan/"].includes(pathname)))}>{content}</BuyerTabNavigation>;
  if (isAuthScreen(pathname)) return wrap(<main className="diwo-auth-shell">{children}</main>);
  if (pathname === "/setup") return wrap(<main>{children}</main>);
  if (!isLoaded) return wrap(<main role="status" className="p-6">Cargando sesión…</main>);
  if (!isSignedIn) return wrap(<RedirectToSignIn />);
  if (soldOut) return wrap(<main className="diwo-app-interface">{soldOutScreen ?? children}</main>);
  if (pathname === "/scan" || pathname === "/scan/") return wrap(<main className="diwo-app-interface min-h-dvh">{children}</main>);
  return wrap(<div className="diwo-app-interface">
    <div className="diwo-app-header-shell"><AuthHeader /></div>
    <main className={`diwo-app-main${/^\/request\/?$/.test(pathname) ? " diwo-app-main-request" : ""}`}><PageMotion pathname={pathname}>{children}</PageMotion></main>
    <AppNavigation role={role} />
  </div>);
}
