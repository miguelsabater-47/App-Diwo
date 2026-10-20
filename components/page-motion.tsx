"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { advanceMotionHistory, motionPath, pageMotionEnabled, type MotionHistory } from "@/lib/page-motion-model";
import { startScrollReveal } from "@/lib/scroll-reveal";

/** Animate only incoming content. Never retain old pages or delay the router. */
export function PageMotion({ pathname, children }: { pathname: string; children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const history = useRef<MotionHistory>({ paths: [], index: 0, pop: false });
  const path = motionPath(pathname);
  const enabled = pageMotionEnabled(path);

  useEffect(() => {
    const pop = () => {
      history.current.pop = motionPath(window.location.pathname) !== history.current.paths[history.current.index];
    };
    // Observe only; never prevent traversal or overwrite Next's history state.
    window.addEventListener("popstate", pop, true);
    return () => window.removeEventListener("popstate", pop, true);
  }, []);

  useLayoutEffect(() => {
    const direction = advanceMotionHistory(history.current, path);
    const node = content.current;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!enabled || preference?.matches || !node?.animate) return;
    let animation: Animation;
    try {
      animation = node.animate([
        { transform: direction === "initial" ? "translateY(10px)" : `translateX(${direction === "back" ? -40 : 40}px)` },
        { transform: "translate(0, 0)" },
      ], { duration: 280, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    } catch { return; } // Decorative motion must never prevent a page from opening.
    const reduce = () => { if (preference?.matches) animation.cancel(); };
    preference?.addEventListener?.("change", reduce);
    return () => {
      animation.cancel();
      preference?.removeEventListener?.("change", reduce);
    };
  }, [path, enabled]);

  useEffect(() => {
    if (!enabled || !content.current) return;
    return startScrollReveal(content.current, window.matchMedia?.("(prefers-reduced-motion: reduce)"));
  }, [path, enabled]);

  return <div ref={content} className="diwo-page-motion" data-motion={enabled ? "enabled" : "disabled"}>{children}</div>;
}
