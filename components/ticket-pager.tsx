"use client";

import { useEffect, useRef, useState, type ReactNode, type PointerEvent } from "react";
import type { TicketNavigation } from "@/lib/ticket-gallery";

type Motion = { phase: "idle" | "drag" | "back" | "commit" | "wait"; x: number; height?: number; target?: number };
type Gesture = { x: number; y: number; pointerId: number; width: number; height: number; previousHeight: number; nextHeight: number; reduced: boolean; offset: number };
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
  const count = navigation?.hrefs.length ?? 0;
  const previousExists = !!navigation && navigation.current > 0;
  const nextExists = !!navigation && navigation.current + 1 < count;
  function update(value: Motion) { phase.current = value.phase; setMotion(value); }
  function clearTimer() { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } }
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    destination.current = null;
  }, []);
  function finish() {
    if (phase.current === "wait") return;
    clearTimer();
    const target = destination.current; destination.current = null;
    if (target !== null) { phase.current = "wait"; onSelect(target, () => update(idle)); }
    else update(idle);
  }
  function release(event: PointerEvent<HTMLElement>) {
    const value = start.current; start.current = null;
    if (value && event.currentTarget.hasPointerCapture(value.pointerId)) event.currentTarget.releasePointerCapture(value.pointerId);
    return value;
  }
  function returnBack(value: Gesture) {
    destination.current = null;
    if (value.reduced || Math.abs(value.offset) < 1) { update(idle); return; }
    update({ phase: "back", x: 0, height: value.height });
    timer.current = window.setTimeout(finish, 300);
  }
  function begin(event: PointerEvent<HTMLElement>) {
    if (phase.current !== "idle" || !navigation || count < 2 || !event.isPrimary || event.button !== 0 ||
      actionArea.current?.querySelector('[aria-busy="true"]') ||
      (event.target instanceof Element && event.target.closest("a,button,input,select,textarea"))) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const height = currentSlide.current?.getBoundingClientRect().height ?? bounds.height;
    if (bounds.width <= 0) return;
    if (event.pointerType === "mouse") event.preventDefault();
    start.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId,
      width: bounds.width, height, previousHeight: previousSlide.current?.getBoundingClientRect().height ?? height,
      nextHeight: nextSlide.current?.getBoundingClientRect().height ?? height,
      reduced: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, offset: 0 };
    event.currentTarget.setPointerCapture(event.pointerId);
    update({ phase: "drag", x: 0, height });
  }
  function move(event: PointerEvent<HTMLElement>) {
    const value = start.current;
    if (!value || value.pointerId !== event.pointerId) return;
    const dx = event.clientX - value.x, dy = event.clientY - value.y;
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { release(event); returnBack(value); return; }
    if (value.reduced || Math.abs(dx) < 6) return;
    const available = dx < 0 ? nextExists : previousExists;
    const x = available ? Math.max(-value.width - gap, Math.min(value.width + gap, dx)) : Math.max(-32, Math.min(32, dx * 0.18));
    value.offset = x;
    const targetHeight = dx < 0 ? value.nextHeight : value.previousHeight;
    const progress = available ? Math.min(1, Math.abs(x) / (value.width + gap)) : 0;
    update({ phase: "drag", x, height: value.height + (targetHeight - value.height) * progress });
  }
  function end(event: PointerEvent<HTMLElement>) {
    if (!start.current || event.pointerId !== start.current.pointerId) return;
    const value = release(event)!;
    const dx = event.clientX - value.x, dy = event.clientY - value.y;
    const target = (navigation?.current ?? 0) + (dx < 0 ? 1 : -1);
    if (!navigation || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || target < 0 || target >= count) { returnBack(value); return; }
    destination.current = target;
    update({ phase: "commit", x: (dx < 0 ? -1 : 1) * (value.width + gap),
      height: dx < 0 ? value.nextHeight : value.previousHeight, target });
    if (value.reduced) finish();
    else timer.current = window.setTimeout(finish, 320); // Fallback if transitionend is interrupted.
  }
  function cancel(event: PointerEvent<HTMLElement>) { if (start.current) { const value = release(event); if (value) returnBack(value); } }
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
        {previousExists && <div ref={previousSlide} className="diwo-ticket-slide diwo-ticket-slide-previous" aria-hidden="true" inert>{previous ?? <div className="diwo-ticket-slide-loading">Cargando entrada…</div>}</div>}
        <div ref={currentSlide} className="diwo-ticket-slide">{children}</div>
        {nextExists && <div ref={nextSlide} className="diwo-ticket-slide diwo-ticket-slide-next" aria-hidden="true" inert>{next ?? <div className="diwo-ticket-slide-loading">Cargando entrada…</div>}</div>}
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
            height: index > navigation.current ? nextSlide.current?.getBoundingClientRect().height : previousSlide.current?.getBoundingClientRect().height,
            target: index });
          timer.current = window.setTimeout(finish, 320);
        }}><span /></a>)}
    </nav>}
  </section>;
}
