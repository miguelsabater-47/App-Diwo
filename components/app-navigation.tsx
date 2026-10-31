"use client";

import Link from "next/link";
import { useContext, type CSSProperties } from "react";
import { BuyerTabPrefetch } from "@/components/buyer-tab-navigation";
import { AdminTabLink } from "@/components/admin-tab-link";
import { usePathname } from "next/navigation";
import { ClipboardList, Home, Ticket, UsersRound } from "lucide-react";

export type NavigationRole = "admin" | "door_staff" | "user" | null;

export function AppNavigation({ role = "user" }: { role?: NavigationRole } = {}) {
  const pathname = usePathname();
  const { enabled: prefetchBuyerTab, homeHref } = useContext(BuyerTabPrefetch);
  if (!role || /^\/request\/?$/.test(pathname)) return null;
  // Explicit customer mock routes retain the customer's presentation, not a second admin bar.
  const customerPreview = ["/ticket/preview", "/ticket/design", "/ticket/payment/preview"].includes(pathname);
  const admin = role === "admin" && !customerPreview;
  const staff = role === "door_staff" && !customerPreview;
  const TabLink = admin ? AdminTabLink : Link;
  if (!admin && !["/", "/account", "/ticket", "/ticket/preview", ...(staff ? ["/door"] : [])].includes(pathname)) return null;
  const items = admin ? [
    { href: "/admin", label: "Inicio", icon: Home, active: ["/", "/admin", "/admin/", "/admin/scan"].includes(pathname) },
    { href: "/admin/requests", label: "Solicitudes", icon: ClipboardList, active: pathname === "/admin/requests" || pathname.startsWith("/admin/requests/") },
    { href: "/admin/tickets", label: "Entradas", icon: Ticket, active: pathname === "/admin/tickets" || pathname.startsWith("/admin/tickets/") },
    { href: "/admin/staff", label: "Personal", icon: UsersRound, active: pathname === "/admin/staff" || pathname.startsWith("/admin/staff/") },
  ] : [
    { href: staff ? "/door" : "/", label: "Inicio", icon: Home, active: pathname === "/" || (staff && pathname === "/door") },
    { href: "/ticket", label: "Mis entradas", icon: Ticket, active: ["/ticket", "/ticket/preview"].includes(pathname) },
  ];
  return (
    <>
    <div aria-hidden="true" className="diwo-app-navigation-shade" />
    <nav aria-label={admin ? "Administración" : "Navegación principal"} className={`diwo-app-navigation${admin ? " diwo-app-navigation-admin" : ""}`}>
      <div className={`diwo-app-navigation-items${admin ? " diwo-app-navigation-items-admin" : ""}`}
        data-active-tab={items.some(item => item.active) ? "true" : "false"}
        style={{ "--tab-count": items.length, "--tab-index": Math.max(0, items.findIndex(item => item.active)) } as CSSProperties}>
        {items.map(({ href, label, icon: Icon, active }) => <TabLink key={href} href={!admin && !customerPreview && prefetchBuyerTab && href === "/" ? homeHref : href}
          prefetch={!admin && !customerPreview ? prefetchBuyerTab && !active : undefined}
          aria-current={active ? "page" : undefined}
          className={`diwo-app-tab${admin ? " diwo-app-tab-admin" : ""} ${active ? "diwo-app-tab-active" : ""}`}>
          <Icon aria-hidden="true" className="size-5" /><span>{label}</span>
        </TabLink>)}
      </div>
    </nav>
    </>
  );
}
