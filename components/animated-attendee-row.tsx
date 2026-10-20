"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Exit rows contain display-only snapshots, never live or submitted inputs. */
export function AnimatedAttendeeRow({ children, animate = true, exiting = false, onExited }: {
  children: ReactNode; animate?: boolean; exiting?: boolean; onExited?: () => void;
}) {
  const row = useRef<HTMLDivElement>(null), callback = useRef(onExited);
  useLayoutEffect(() => { callback.current = onExited; }, [onExited]);
  useLayoutEffect(() => {
    const node = row.current;
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!node || !animate || preference?.matches || !node.animate) { if (exiting) callback.current?.(); return; }
    const height = node.getBoundingClientRect().height;
    let disposed = false, completed = false;
    const finish = () => { if (!disposed && !completed && exiting) { completed = true; callback.current?.(); } };
    let animation: Animation;
    try {
      const open = { height: `${height}px`, opacity: 1, transform: "translateY(0)", overflow: "hidden" };
      const closed = { height: "0px", opacity: 0, transform: "translateY(-6px)", overflow: "hidden" };
      animation = node.animate(exiting ? [open, closed] : [closed, open], { duration: 180, easing: "ease-in-out", fill: exiting ? "forwards" : "none" });
      animation.onfinish = finish;
    } catch { finish(); return; }
    const reduce = () => { if (preference?.matches) { animation.cancel(); finish(); } };
    preference?.addEventListener?.("change", reduce);
    return () => {
      disposed = true; animation.onfinish = null; animation.cancel();
      preference?.removeEventListener?.("change", reduce);
    };
  }, [animate, exiting]);
  return <div ref={row} className="diwo-attendee-row" aria-hidden={exiting || undefined} inert={exiting || undefined}>
    <div className="diwo-attendee-row-inner">{children}</div>
  </div>;
}
