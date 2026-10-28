import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { hasConfiguredClerkKeys, configuredAppOrigin, isPrivilegedPath, isLegacyRedemptionPath, isConfiguredOrderAdminPage, isConfiguredExtraTicketApi, isConfiguredDoorPage, isLocalScanRehearsal } from "@/lib/local-access";

const handleClerk = clerkMiddleware({ authorizedParties: [configuredAppOrigin(process.env) ?? "http://localhost:3000"] });

export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (isPrivilegedPath(req.nextUrl.pathname) && !["/api/admin/event-control", "/api/admin/event-control/"].includes(req.nextUrl.pathname) && !isConfiguredOrderAdminPage(req.nextUrl.pathname) && !isConfiguredExtraTicketApi(req.nextUrl.pathname) && !isConfiguredDoorPage(req.nextUrl.pathname) && !isLocalScanRehearsal(req.nextUrl.pathname, req.nextUrl.origin, process.env)) {
    return NextResponse.json({ error: "authorization_not_configured" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  if (isLegacyRedemptionPath(req.nextUrl.pathname)) {
    return NextResponse.json({ error: "legacy_workflow_disabled" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (!hasConfiguredClerkKeys(process.env)) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "local_configuration_required" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if (!["/", "/setup"].includes(req.nextUrl.pathname)) {
      return NextResponse.redirect(new URL("/setup", req.url));
    }
    return NextResponse.next();
  }
  if (req.nextUrl.origin !== configuredAppOrigin(process.env)) {
    return NextResponse.json({ error: "request_origin_not_allowed" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  return handleClerk(req, event);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
