import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { esES } from "@clerk/localizations";
import "./globals.css";
import { AppChrome } from "@/components/app-chrome";
import "@/components/login-screen.css";
import "@/components/app-interface.css";
import "@/components/ticket-request.css";
import { Toaster } from "@/components/ui/sonner";
import { hasDevelopmentClerkKeys } from "@/lib/local-access";
import { LocalSetupNotice } from "@/components/local-setup-notice";

export const metadata: Metadata = {
  title: "DIWO X 2.0 · Acceso local",
  description: "Pruebas locales de acceso a DIWO X 2.0",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!hasDevelopmentClerkKeys(process.env)) {
    return (
      <html lang="es">
        <body className="min-h-dvh bg-background text-foreground"><LocalSetupNotice /></body>
      </html>
    );
  }

  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      localization={esES}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
      appearance={{ variables: { colorPrimary: "#eaff00", colorTextOnPrimaryBackground: "#111111" } }}
    >
      <html lang="es" suppressHydrationWarning>
        <body className="min-h-dvh flex flex-col antialiased bg-background text-foreground overflow-x-hidden">
          <AppChrome>{children}</AppChrome>

          <Toaster
            richColors
            position="top-center"
            closeButton
            offset={64}
            duration={2800}
          />
        </body>
      </html>
    </ClerkProvider>
  );
}
