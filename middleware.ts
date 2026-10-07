// middleware.ts
import { clerkMiddleware, clerkClient, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)", "/api/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isAdminRoute(req)) return NextResponse.next();

  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: req.url });

  const client = await clerkClient(); // 👈
  const user = await client.users.getUser(userId);

  const priv = user.privateMetadata ?? {};
  const isAdmin = priv.isAdmin === true || priv.role === "admin";
  if (!isAdmin) return NextResponse.redirect(new URL("/404", req.url));

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next|.*\\.(?:png|jpg|jpeg|svg|ico|css|js)).*)"],
};
