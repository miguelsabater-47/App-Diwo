"use client";

import { usePathname } from "next/navigation";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";
import AuthHeader from "@/components/auth-header";
import { AppNavigation, type NavigationRole } from "@/components/app-navigation";
import { isAuthScreen } from "@/lib/login-flow";
import { BuyerTabNavigation } from "@/components/buyer-tab-navigation";

/** Presentation only: server authorization and Clerk configuration stay upstream. */
export function AppChrome({ children, role = "user" }: { children: React.ReactNode; role?: NavigationRole }) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();
  // Keep the session boundary mounted even during sign-out/auth transitions.
  const wrap = (content: React.ReactNode) => <BuyerTabNavigation enabled={role === "user" || role === "door_staff"}>{content}</BuyerTabNavigation>;
  if (isAuthScreen(pathname)) return wrap(<main className="diwo-auth-shell">{children}</main>);
  if (pathname === "/setup") return wrap(<main>{children}</main>);
  if (!isLoaded) return wrap(<main role="status" className="p-6">Cargando sesión…</main>);
  if (!isSignedIn) return wrap(<RedirectToSignIn />);
  if (pathname === "/scan" || pathname === "/scan/") return wrap(<main className="diwo-app-interface min-h-dvh">{children}</main>);
  return wrap(<div className="diwo-app-interface">
    <div className="diwo-app-header-shell"><AuthHeader /></div>
    <main className={`diwo-app-main${/^\/request\/?$/.test(pathname) ? " diwo-app-main-request" : ""}`}>{children}</main>
    <AppNavigation role={role} />
  </div>);
}
