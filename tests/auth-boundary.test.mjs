import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { isAuthScreen } from "../lib/login-flow.ts";
import { Suspense } from "react";

function load(path, dependencies) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const moduleObject = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, moduleObject, moduleObject.exports);
  return moduleObject.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}

test("recovery has its own screen while native Clerk keeps its nested security routes", async () => {
  const Page = load("../app/sign-in/[[...sign-in]]/page.tsx", {
    "@/components/login-screen": { LoginScreen: "login" },
    "@/components/password-recovery-screen": { PasswordRecoveryScreen: "recovery" },
  }).default;
  const route = parts => Page({ params: Promise.resolve({ "sign-in": parts }) });
  assert.equal((await route(["recover"])).type, "recovery");
  assert.equal((await route([])).props.nativePath, null);
  assert.equal((await route(["clerk", "factor-two"])).props.nativePath, "/sign-in/clerk");
  assert.equal((await route(["recover", "unknown"])).type, "login");
  assert.equal(isAuthScreen("/sign-in/recover"), true);
});

test("signup provides a visible back link without changing native registration", () => {
  const SignUpPage = load("../app/sign-up/[[...sign-up]]/page.tsx", {
    "@clerk/nextjs": { SignUp: "signup" },
    "next/link": { default: "a" },
    "lucide-react": { ArrowLeft: "svg" },
    "./sign-up.css": {},
  }).default;
  const tree = nodes(SignUpPage());
  const back = tree.find(node => node.type === "a" && node.props.href === "/sign-in");
  assert.ok(back, "Visible back link returns to login");
  assert.ok([back.props.children].flat().includes("Volver"));
  const signup = tree.find(node => node.type === "signup");
  assert.equal(signup.props.path, "/sign-up");
  assert.equal(signup.props.forceRedirectUrl, "/");
});

test("native signup shares login sizing without scaling, fixed-height clipping or nested card padding", () => {
  const SignUpPage = load("../app/sign-up/[[...sign-up]]/page.tsx", {
    "@clerk/nextjs": { SignUp: "signup" }, "next/link": { default: "a" },
    "lucide-react": { ArrowLeft: "svg" }, "./sign-up.css": {},
  }).default;
  const view = SignUpPage(), all = nodes(view);
  assert.equal(view.props.className, "diwo-sign-up");
  const signup = all.find(node => node.type === "signup");
  assert.equal(signup.props.path, "/sign-up");
  assert.equal(signup.props.routing, "path");
  assert.equal(signup.props.signInUrl, "/sign-in");
  assert.equal(signup.props.forceRedirectUrl, "/");
  const elements = signup.props.appearance.elements;
  for (const name of ["rootBox", "cardBox", "card"]) {
    assert.equal(elements[name].width, "100%");
    assert.equal(elements[name].minWidth, "0");
  }
  assert.equal(elements.card.padding, "0");
  for (const name of ["formFieldInput", "socialButtonsBlockButton", "formButtonPrimary"]) {
    assert.equal(elements[name].minHeight, "var(--diwo-auth-control-height)");
    assert.equal(elements[name].fontSize, "var(--diwo-auth-input-size)");
  }
  const loginCss = readFileSync(new URL("../components/login-screen.css", import.meta.url), "utf8");
  const signupCss = readFileSync(new URL("../app/sign-up/[[...sign-up]]/sign-up.css", import.meta.url), "utf8");
  for (const variable of ["--diwo-auth-max-width", "--diwo-auth-inline-padding"]) {
    assert.ok(loginCss.includes(`var(${variable})`));
    assert.ok(signupCss.includes(`var(${variable})`));
  }
  assert.match(signupCss, /min-height:\s*100svh/);
  assert.doesNotMatch(signupCss, /\bzoom\s*:|scale\s*\(|overflow(?:-y)?\s*:\s*hidden/);
});

test("provider and Google callback consistently complete at Home while logout remains login", async () => {
  const RootLayout = load("../app/layout.tsx", {
    "@clerk/nextjs": { ClerkProvider: "provider" },
    "@clerk/localizations": { esES: {} }, "./globals.css": {},
    "@/components/login-screen.css": {}, "@/components/app-interface.css": {},
    "@/components/ticket-request.css": {},
    "@/components/owned-ticket.css": {},
    "@/components/admin-requests.css": {},
    "@/components/admin-tickets.css": {},
    "@/components/admin-staff.css": {},
    "@/components/door-scanner.css": {},
    "@/components/app-chrome": { AppChrome: "chrome" },
    "@/components/ui/sonner": { Toaster: "toaster" },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => ({ ok: true, role: "user" }) },
    "@/components/local-setup-notice": { LocalSetupNotice: "setup-notice" },
  }).default;
  const provider = nodes(await RootLayout({ children: "content" })).find(node => node.type === "provider");
  assert.equal(provider.props.signInFallbackRedirectUrl, "/");
  assert.equal(provider.props.signUpFallbackRedirectUrl, "/");
  assert.equal(provider.props.afterSignOutUrl, "/sign-in");
  const Callback = load("../app/sso-callback/page.tsx", {
    "@clerk/nextjs": { AuthenticateWithRedirectCallback: "callback" },
  }).default;
  const callback = nodes(Callback()).find(node => node.type === "callback");
  assert.equal(callback.props.signInForceRedirectUrl, "/");
  assert.equal(callback.props.signUpForceRedirectUrl, "/");
});

test("route transitions have a neutral accessible loading screen instead of a blank page", () => {
  const Loading = load("../app/loading.tsx", { "lucide-react": { LoaderCircle: "svg" } }).default;
  const status = nodes(Loading()).find(node => node.props?.role === "status");
  assert.ok(status);
  assert.equal(nodes(Loading()).some(node => String(node.props?.className).includes("animate-spin")), false);
  assert.ok(nodes(Loading()).some(node => node.props?.className === "sr-only" && node.props.children === "Cargando contenido…"));
  assert.equal(nodes(Loading()).some(node => node.type === "a" || node.type === "button" || node.type === "form"), false);
});

test("Home redirects anonymous visitors but preserves buyer, admin and permission-error views", async () => {
  let access = { ok: false, status: 401 };
  let overviewReads = 0;
  const Home = load("../app/page.tsx", {
    react: { Suspense },
    "next/link": { default: "a" },
    "next/navigation": { redirect(path) { throw new Error(`redirect:${path}`); } },
    "lucide-react": { LayoutDashboard: "svg", ClipboardList: "svg", ScanLine: "svg" },
    "@/components/ui/button": { Button: "button" },
    "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/app-authorization": { getCurrentAppAccess: async () => access },
    "@/lib/order-reads": { readOrderOverview: async () => { overviewReads++; return { ok: true, orders: [] }; } },
    "@/lib/order-view-model": { orderSummary: () => ({ pending: 0 }) },
    "@/components/attendee-home": { AttendeeHome: "attendee-home", renderHomeRequest: context => context },
    "@/lib/buyer-request-context": { buyerRequestContext: () => ({ state: "none", eventId: null, recorded: [] }) },
  }).default;
  await assert.rejects(Home(), /redirect:\/sign-in/);
  assert.equal(overviewReads, 0);
  for (const role of ["user", "door_staff"]) {
    access = { ok: true, role };
    const home = await Home();
    assert.equal(home.type, "attendee-home");
    await home.props.requestSection.props.children.type();
  }
  assert.equal(overviewReads, 2);
  access = { ok: true, role: "admin" };
  await assert.rejects(Home(), /redirect:\/admin$/);
  assert.equal(overviewReads, 2, "Admin Home still redirects without any additional overview read");
  access = { ok: false, status: 503 };
  assert.ok(nodes(await Home()).some(node => node.props?.role === "alert"));
});

test("app shell hides anonymous/loading content without blocking auth or setup screens", () => {
  let pathname = "/", ready = true, signedIn = false;
  const AppChrome = load("../components/app-chrome.tsx", {
    "@/components/buyer-tab-navigation": { BuyerTabNavigation: "buyer-navigation" },
    "next/navigation": { usePathname: () => pathname },
    "@clerk/nextjs": { RedirectToSignIn: "login-redirect", useAuth: () => ({ isLoaded: ready, isSignedIn: signedIn }) },
    "@/components/auth-header": { default: "header" },
    "@/components/app-navigation": { AppNavigation: "nav" },
    "@/lib/login-flow": { isAuthScreen },
  }).AppChrome;
  const render = () => nodes(AppChrome({ children: "private-content" }));
  for (const role of ["user", "door_staff", "admin", null]) {
    const boundary = AppChrome({ children: "private-content", role });
    assert.equal(boundary.type, "buyer-navigation");
    assert.equal(boundary.props.enabled, role === "user" || role === "door_staff");
  }
  for (const loaded of [false, true]) {
    ready = loaded;
    const tree = render();
    assert.equal(tree.some(node => node.type === "nav" || node.type === "header"), false);
    assert.equal(tree.some(node => node.props?.children === "private-content"), false);
    assert.ok(tree.some(node => loaded ? node.type === "login-redirect" : node.props?.role === "status"));
  }
  ready = true; signedIn = true;
  assert.ok(render().some(node => node.type === "nav"));
  signedIn = false;
  for (const path of ["/account", "/ticket", "/request", "/sign-in-extra", "/setup/extra"]) {
    pathname = path;
    assert.ok(render().some(node => node.type === "login-redirect"));
  }
  for (const path of ["/sign-in", "/sign-up", "/sign-in/clerk", "/sso-callback", "/setup"]) {
    pathname = path;
    assert.ok(render().some(node => node.props?.children === "private-content"));
    assert.equal(render().some(node => node.type === "nav"), false);
  }
});

test("logout button and provider both target login without profile-modal actions", () => {
  const AccountActions = load("../components/account-actions.tsx", {
    "@clerk/nextjs": { SignOutButton: "signout", useUser: () => ({ isLoaded: true, user: { primaryEmailAddress: { emailAddress: "buyer@example.com" } } }), useClerk: () => ({ openUserProfile() {} }) },
    "@/components/ui/button": { Button: "button" },
  }).AccountActions;
  const tree = nodes(AccountActions());
  assert.equal(tree.find(node => node.type === "signout").props.redirectUrl, "/sign-in");
  assert.equal(tree.filter(node => typeof node.props?.onClick === "function").length, 0);
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /afterSignOutUrl="\/sign-in"/);
});
