"use client";

import Link from "next/link";
import { useContext } from "react";
import { BuyerTabPrefetch } from "@/components/buyer-tab-navigation";
import { usePathname } from "next/navigation";
import { Home, Ticket, LayoutDashboard, ClipboardList, ScanLine, UsersRound } from "lucide-react";

export type NavigationRole = "admin" | "door_staff" | "user" | null;

export function AppNavigation({ role = "user" }: { role?: NavigationRole } = {}) {
  const pathname = usePathname();
  const prefetchBuyerTab = useContext(BuyerTabPrefetch);
  if (!role) return null;
  // Explicit customer mock routes retain the customer's presentation, not a second admin bar.
  const customerPreview = ["/ticket/preview", "/ticket/design", "/ticket/payment/preview"].includes(pathname);
  const admin = role === "admin" && !customerPreview;
  if (!admin && !["/", "/account", "/ticket", "/ticket/preview", "/request"].includes(pathname)) return null;
  const items = admin ? [
    { href: "/admin", label: "Resumen", icon: LayoutDashboard, active: ["/", "/admin", "/admin/"].includes(pathname) },
    { href: "/admin/requests", label: "Solicitudes", icon: ClipboardList, active: pathname === "/admin/requests" || pathname.startsWith("/admin/requests/") },
    { href: "/admin/scan", label: "Escáner", icon: ScanLine, active: pathname === "/admin/scan" || pathname.startsWith("/admin/scan/") },
    { href: "/admin/tickets", label: "Entradas", icon: Ticket, active: pathname === "/admin/tickets" || pathname.startsWith("/admin/tickets/") },
    { href: "/admin/staff", label: "Personal", icon: UsersRound, active: pathname === "/admin/staff" || pathname.startsWith("/admin/staff/") },
  ] : [
    { href: "/", label: "Inicio", icon: Home, active: pathname === "/" },
    { href: "/ticket", label: "Mis entradas", icon: Ticket, active: ["/ticket", "/ticket/preview"].includes(pathname) },
  ];
  return (
    <nav aria-label={admin ? "Administración" : "Navegación principal"} className={`diwo-app-navigation${admin ? " diwo-app-navigation-admin" : ""}`}>
      <div className={`diwo-app-navigation-items${admin ? " diwo-app-navigation-items-admin" : ""}`}>
        {items.map(({ href, label, icon: Icon, active }) => <Link key={href} href={href}
          prefetch={!admin && !customerPreview ? prefetchBuyerTab && !active : undefined}
          aria-current={active ? "page" : undefined}
          className={`diwo-app-tab${admin ? " diwo-app-tab-admin" : ""} ${active ? "diwo-app-tab-active" : ""}`}>
          <Icon aria-hidden="true" className="size-5" /><span>{label}</span>
        </Link>)}
      </div>
    </nav>
  );
}
