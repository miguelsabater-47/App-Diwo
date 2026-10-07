import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import AuthHeader from "@/components/auth-header";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = {
  title: "Diwo Club Official",
  description: "Diwo Club Official Tickets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
    >
      <html lang="es" suppressHydrationWarning>
        <body className="min-h-dvh flex flex-col antialiased bg-background text-foreground overflow-x-hidden">
          <div className="sticky top-0 z-50 pt-[env(safe-area-inset-top)] bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
            <AuthHeader />
          </div>

          <main className="flex-1 min-h-0">{children}</main>

          <Toaster
            richColors
            position="top-center"
            closeButton
            offset={64}
            duration={2800}
          />
          <Analytics />
        </body>
      </html>
    </ClerkProvider>
  );
}
