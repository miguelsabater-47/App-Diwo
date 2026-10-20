"use client";

import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { TicketNavigation } from "@/lib/ticket-gallery";

type Motion = { phase: "idle" | "drag" | "back" | "commit" | "wait"; x: number; height?: number; target?: number };
type Gesture = { x: number; y: number; pointerId: number; width: number; height: number; reduced: boolean; offset: number; horizontal: boolean; startedAt: number };
const gap = 16;
const idle: Motion = { phase: "idle", x: 0 };

export function TicketPager({ navigation, children, previous, next, actions, onSelect }: {
  navigation?: TicketNavigation | null; children: ReactNode; previous?: ReactNode; next?: ReactNode; actions?: ReactNode;
  onSelect: (index: number, settled: () => void) => void;
}) {
  const start = useRef<Gesture | null>(null);
  const currentSlide = useRef<HTMLDivElement>(null), previousSlide = useRef<HTMLDivElement>(null), nextSlide = useRef<HTMLDivElement>(null);
  const actionArea = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const phase = useRef<Motion["phase"]>("idle"), destination = useRef<number | null>(null), timer = useRef<number | null>(null);
  const [motion, setMotion] = useState<Motion>(idle);
  const decoded = useRef(new WeakMap<HTMLImageElement, string>());
  const count = navigation?.hrefs.length ?? 0;
  const previousExists = !!navigation && navigation.current > 0;
  const nextExists = !!navigation && navigation.current + 1 < count;
  function update(value: Motion) { phase.current = value.phase; setMotion(value); }
  function clearTimer() { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } }
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    destination.current = null;
  }, []);
  useEffect(() => {
    // Decode the mounted neighbors before a gesture, not only when they become
    // visible. Stable slide keys below retain those same image DOM nodes.
    for (const slide of [currentSlide.current, previousSlide.current, nextSlide.current]) {
      for (const image of slide?.querySelectorAll<HTMLImageElement>("img") ?? []) {
        const src = image.src;
        if (!src || decoded.current.get(image) === src || !image.decode) continue;
        decoded.current.set(image, src);
        const failed = () => { if (decoded.current.get(image) === src) decoded.current.delete(image); };
        try { void image.decode().catch(failed); }
        catch { failed(); }
      }
    }
  }, [children, previous, next]);
  function finish() {
    if (phase.current === "wait") return;
    clearTimer();
    const target = destination.current; destination.current = null;
    if (target !== null) {
      phase.current = "wait";
      try { onSelect(target, () => update(idle)); }
      catch { update(idle); }
    }
    else update(idle);
  }
  function release(event: PointerEvent<HTMLElement>) {
    const value = start.current; start.current = null;
    if (value && event.currentTarget.hasPointerCapture(value.pointerId)) event.currentTarget.releasePointerCapture(value.pointerId);
    return value;
  }
  function returnBack(value: Gesture) {
    clearTimer();
    destination.current = null;
    if (value.reduced || Math.abs(value.offset) < 1) { update(idle); return; }
    update({ phase: "back", x: 0, height: value.height });
    timer.current = window.setTimeout(finish, 300);
  }
  function begin(event: PointerEvent<HTMLElement>) {
    if ((phase.current !== "idle" && phase.current !== "back") || start.current || !navigation || count < 2 || !event.isPrimary || event.button !== 0 ||
      actionArea.current?.querySelector('[aria-busy="true"]') ||
      (event.target instanceof Element && event.target.closest("a,button,input,select,textarea"))) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const height = currentSlide.current?.getBoundingClientRect().height ?? bounds.height;
    if (bounds.width <= 0) return;
    clearTimer();
    if (event.pointerType === "mouse") event.preventDefault();
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
      width: bounds.width, height,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, offset: 0,
      horizontal: false, startedAt: event.timeStamp };
    try { event.currentTarget.setPointerCapture(event.pointerId); }
    catch { start.current = null; update(idle); return; }
    update(idle);
  }
  function move(event: PointerEvent<HTMLElement>) {
    const value = start.current;
    if (!value || value.pointerId !== event.pointerId) return;
    const dx = event.clientX - value.x, dy = event.clientY - value.y;
    if (!value.horizontal) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx) * 1.2) { release(event); returnBack(value); return; }
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy) * 1.1) return;
      value.horizontal = true;
    }
    if (event.cancelable) event.preventDefault();
    if (value.reduced || Math.abs(dx) < 6) return;
    const available = dx < 0 ? nextExists : previousExists;
    const x = available ? Math.max(-value.width - gap, Math.min(value.width + gap, dx)) : Math.max(-32, Math.min(32, dx * 0.18));
    value.offset = x;
    // Resizing during a horizontal gesture can clamp/anchor the page scroll,
    // especially when swiping right to a shorter previous ticket near the bottom.
    update({ phase: "drag", x, height: value.height });
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (!start.current || event.pointerId !== start.current.pointerId) return;
    const value = release(event)!;
    const dx = event.clientX - value.x, dy = event.clientY - value.y;
    const target = (navigation?.current ?? 0) + (dx < 0 ? 1 : -1);
    const distance = Math.abs(dx), elapsed = event.timeStamp - value.startedAt;
    const flick = distance >= 24 && elapsed > 0 && elapsed <= 300 && distance / elapsed >= 0.45;
    const threshold = Math.min(56, Math.max(36, value.width * 0.12));
    if (!navigation || (!flick && distance < threshold) ||
      (!value.horizontal && distance < Math.abs(dy) * 1.1) || target < 0 || target >= count) { returnBack(value); return; }
    destination.current = target;
    update({ phase: "commit", x: (dx < 0 ? -1 : 1) * (value.width + gap),
      height: value.height, target });
    if (value.reduced) finish();
    else timer.current = window.setTimeout(finish, 320); // Fallback if transitionend is interrupted.
  }
  function cancel(event: PointerEvent<HTMLElement>) {
    if (start.current?.pointerId === event.pointerId) { const value = release(event); if (value) returnBack(value); }
  }
  const moving = motion.phase !== "idle";
  const displayed = motion.target ?? navigation?.current ?? 0;
  return <section className="diwo-ticket-screen">
    <header className="diwo-ticket-heading">
      <h1>{navigation && count ? `Entrada ${displayed + 1} de ${count}` : "Tu entrada"}</h1>
      {count > 1 && <p>Desliza para ver más entradas</p>}
    </header>
    <div ref={viewport} className={`diwo-ticket-content diwo-ticket-viewport${motion.phase === "back" || motion.phase === "commit" ? " is-settling" : ""}`}
      data-swipe-enabled={count > 1 ? "true" : undefined} data-dragging={motion.phase === "drag" ? "true" : undefined}
      style={{ height: motion.height }} onPointerDown={begin} onPointerMove={move} onPointerUp={end}
      onPointerCancel={cancel} onLostPointerCapture={cancel} onDragStart={event => event.preventDefault()}>
      <div className="diwo-ticket-track" style={{ transform: `translate3d(${motion.x}px, 0, 0)` }}
        onTransitionEnd={event => { if (event.target === event.currentTarget && event.propertyName === "transform" && (phase.current === "back" || phase.current === "commit")) finish(); }}>
        {previousExists && <div key={navigation.hrefs[navigation.current - 1]} ref={previousSlide} className="diwo-ticket-slide diwo-ticket-slide-previous" aria-hidden="true" inert>{previous ?? <div className="diwo-ticket-slide-loading">Cargando entrada…</div>}</div>}
        <div key={navigation?.hrefs[navigation.current] ?? "current"} ref={currentSlide} className="diwo-ticket-slide">{children}</div>
        {nextExists && <div key={navigation.hrefs[navigation.current + 1]} ref={nextSlide} className="diwo-ticket-slide diwo-ticket-slide-next" aria-hidden="true" inert>{next ?? <div className="diwo-ticket-slide-loading">Cargando entrada…</div>}</div>}
      </div>
    </div>
    <div ref={actionArea} inert={moving}>{actions}</div>
    {navigation && count > 1 && <nav className="diwo-ticket-dots" aria-label="Entradas de esta solicitud" inert={moving}>
      {navigation.hrefs.map((href, index) => <a key={href} href={href} aria-label={`Ver entrada ${index + 1} de ${count}`}
        aria-current={index === displayed ? "page" : undefined} onClick={event => {
          if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          if (phase.current !== "idle" || index === navigation.current || actionArea.current?.querySelector('[aria-busy="true"]')) return;
          destination.current = index;
          const bounds = viewport.current?.getBoundingClientRect();
          const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
          if (!bounds || reduced || Math.abs(index - navigation.current) !== 1) {
            update({ phase: "commit", x: 0 }); finish(); return;
          }
          update({ phase: "commit", x: (index > navigation.current ? -1 : 1) * (bounds.width + gap),
            height: currentSlide.current?.getBoundingClientRect().height ?? bounds.height,
            target: index });
          timer.current = window.setTimeout(finish, 320);
        }}><span /></a>)}
    </nav>}
  </section>;
}
