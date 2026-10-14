"use client";

import { usePathname } from "next/navigation";
import { RedirectToSignIn, useAuth } from "@clerk/nextjs";
import AuthHeader from "@/components/auth-header";
import { AppNavigation } from "@/components/app-navigation";
import { isAuthScreen } from "@/lib/login-flow";

/** Presentation only: server authorization and Clerk configuration stay upstream. */
export function AppChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isLoaded, isSignedIn } = useAuth();
  if (isAuthScreen(pathname)) return <main className="diwo-auth-shell">{children}</main>;
  if (pathname === "/setup") return <main>{children}</main>;
  if (!isLoaded) return <main role="status" className="p-6">Cargando sesión…</main>;
  if (!isSignedIn) return <RedirectToSignIn />;
  return <div className="diwo-app-interface">
    <div className="diwo-app-header-sticky"><AuthHeader /></div>
    <main className="diwo-app-main">{children}</main>
    <AppNavigation />
  </div>;
}
