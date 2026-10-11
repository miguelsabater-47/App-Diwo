import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { hasDevelopmentClerkKeys, isPrivilegedPath, isLegacyRedemptionPath } from "@/lib/local-access";

const handleClerk = clerkMiddleware();

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isPrivilegedPath(req.nextUrl.pathname)) {
    return NextResponse.json({ error: "authorization_not_configured" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (isLegacyRedemptionPath(req.nextUrl.pathname)) {
    return NextResponse.json({ error: "legacy_workflow_disabled" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasDevelopmentClerkKeys(process.env)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "local_configuration_required" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!["/", "/setup"].includes(req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL("/setup", req.url));
    }
    return NextResponse.next();
  }
  return handleClerk(req, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
