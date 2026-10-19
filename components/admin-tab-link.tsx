"use client";

import Link, { useLinkStatus } from "next/link";
import type { ComponentProps } from "react";

const loaders: Record<string, () => Promise<unknown>> = {
  "/admin/requests": () => import("@/components/admin-requests"),
  "/admin/tickets": () => import("@/components/admin-tickets"),
  "/admin/staff": () => import("@/components/door-staff-manager"),
};
const pending = new Map<string, Promise<unknown>>();

function preload(href: string) {
  if (!Object.hasOwn(loaders, href) || pending.has(href)) return;
  const request = loaders[href]().catch(() => { pending.delete(href); });
  pending.set(href, request);
}

type Props = Omit<ComponentProps<typeof Link>, "href" | "prefetch"> & { href: string };

function AdminLinkStatus() {
  const { pending } = useLinkStatus();
  return <span role="status" className="diwo-admin-link-status" data-pending={pending || undefined}>
    {pending && <span className="sr-only">Cargando…</span>}
  </span>;
}

/** Warm code only, not privileged RSC data. Importing never mounts the screen. */
export function AdminTabLink({ href, onPointerEnter, onFocus, onTouchStart, children, ...props }: Props) {
  const warm = (event: { defaultPrevented: boolean }) => {
    if (!event.defaultPrevented && props["aria-current"] !== "page" &&
        props["aria-disabled"] !== true && props["aria-disabled"] !== "true") preload(href);
  };
  return <Link {...props} href={href}
    onPointerEnter={event => { onPointerEnter?.(event); warm(event); }}
    onFocus={event => { onFocus?.(event); warm(event); }}
    onTouchStart={event => { onTouchStart?.(event); warm(event); }}>
    {children}<AdminLinkStatus />
  </Link>;
}
