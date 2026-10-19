"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Animate only incoming content. Never retain old pages or delay the router. */
export function PageMotion({ pathname, children }: { pathname: string; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const path = pathname.replace(/\/+$/, "") || "/";
  const ticketDetail = /^\/ticket\/[^/]+$/.test(path) && path !== "/ticket/preview";
  const enabled = !ticketDetail && !/^\/(?:admin\/)?scan(?:\/|$)/.test(path);

  useEffect(() => {
    const node = content.current;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!enabled || preference?.matches || !node?.animate) return;
    let animation: Animation;
    try {
      animation = node.animate([
        { opacity: 0.7, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: 160, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" });
    } catch { return; } // Decorative motion must never prevent a page from opening.
    const reduce = () => { if (preference?.matches) animation.cancel(); };
    preference?.addEventListener?.("change", reduce);
    return () => {
      animation.cancel();
      preference?.removeEventListener?.("change", reduce);
    };
  }, [pathname, enabled]);

  return <div ref={content} className="diwo-page-motion" data-motion={enabled ? "enabled" : "disabled"}>{children}</div>;
}
