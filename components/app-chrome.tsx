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
  return <>
    <div className="sticky top-0 z-50 pt-[env(safe-area-inset-top)] bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b"><AuthHeader /></div>
    <main className="flex-1 min-h-0 pb-24">{children}</main>
    <AppNavigation />
  </>;
}
