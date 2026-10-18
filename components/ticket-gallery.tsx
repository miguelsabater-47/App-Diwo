"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { OwnedTicketCard } from "@/components/owned-ticket-card";
import { OwnedTicketActions } from "@/components/owned-ticket-actions";
import { TicketPager } from "@/components/ticket-pager";
import { carouselTicket, ticketIdFromHref, type AdjacentTickets, type ReadyTicket } from "@/lib/ticket-carousel-model";
import type { TicketNavigation } from "@/lib/ticket-gallery";

export function TicketGallery({ initial, navigation, adjacent, designPreview = false }: {
  initial: ReadyTicket; navigation?: TicketNavigation | null; adjacent?: AdjacentTickets; designPreview?: boolean;
}) {
  const { userId, isLoaded } = useAuth();
  const actor = useRef(userId);
  const initialIndex = navigation?.current ?? 0;
  const [selected, setSelected] = useState(() => {
    if (!navigation || typeof window === "undefined") return initialIndex;
    const href = `${window.location.pathname}${window.location.search}`;
    const id = ticketIdFromHref(href);
    const restored = navigation.hrefs.findIndex(candidate => id ? ticketIdFromHref(candidate) === id : candidate === href);
    return restored < 0 ? initialIndex : restored;
  });
  const [, redraw] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const selectedRef = useRef(selected), alive = useRef(true), locked = useRef(false);
  const cache = useRef<Map<number, ReadyTicket> | null>(null);
  if (!cache.current) {
    cache.current = new Map([[initialIndex, initial]]);
    if (adjacent?.previous) cache.current.set(initialIndex - 1, adjacent.previous);
    if (adjacent?.next) cache.current.set(initialIndex + 1, adjacent.next);
  }
  const requests = useRef(new Map<number, Promise<ReadyTicket | null>>());
  const controllers = useRef(new Set<AbortController>());
  const lastChecked = useRef(initialIndex);
  useEffect(() => {
    alive.current = true;
    const pending = controllers.current;
    return () => { alive.current = false; pending.forEach(controller => controller.abort()); };
  }, []);
  useEffect(() => {
    if (!isLoaded) return;
    if (actor.current === undefined && userId) { actor.current = userId; return; }
    if (!userId || actor.current !== userId) {
      actor.current = userId; locked.current = true;
      controllers.current.forEach(controller => controller.abort());
      cache.current?.clear(); redraw(value => value + 1);
      setMessage("Tu sesión ha cambiado. Actualiza para consultar las entradas de la cuenta actual.");
    }
  }, [isLoaded, userId]);

  const read = useCallback((index: number, force = false): Promise<ReadyTicket | null> => {
    if (locked.current) return Promise.resolve(null);
    if (!force && cache.current?.has(index)) return Promise.resolve(cache.current.get(index)!);
    if (requests.current.has(index)) return requests.current.get(index)!;
    const href = navigation?.hrefs[index];
    const id = href ? ticketIdFromHref(href) : null;
    if (designPreview || !id) return Promise.resolve(null); // Never request a synthetic design ID.
    const controller = new AbortController(); controllers.current.add(controller);
    const promise = (async () => {
      try {
        const response = await fetch(`/api/tickets/${encodeURIComponent(id)}`, {
          credentials: "same-origin", cache: "no-store", redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
        });
        if (!alive.current || controller.signal.aborted) return null;
        if ([401, 403, 404].includes(response.status)) {
          locked.current = true; cache.current?.clear(); redraw(value => value + 1);
          setMessage("No podemos verificar el acceso a tus entradas. Actualiza la página o vuelve a iniciar sesión.");
          return null;
        }
        if (!response.ok) throw new Error("ticket_read_failed");
        const parsed = carouselTicket(await response.json(), id, initial);
        if (!alive.current || controller.signal.aborted || locked.current) return null;
        if (!parsed) {
          cache.current?.delete(index); redraw(value => value + 1);
          if (index === selectedRef.current) setMessage("No hemos podido verificar los datos de esta entrada. Actualiza antes de continuar.");
          return null;
        }
        cache.current?.set(index, parsed); redraw(value => value + 1);
        if (index === selectedRef.current) setMessage(null);
        return parsed;
      } catch {
        if (alive.current && !controller.signal.aborted && index === selectedRef.current) setMessage("No hemos podido actualizar el estado. Comprueba tu conexión; no se ha realizado ninguna operación.");
        return null;
      } finally {
        controllers.current.delete(controller);
      }
    })();
    requests.current.set(index, promise);
    void promise.finally(() => { if (requests.current.get(index) === promise) requests.current.delete(index); });
    return promise;
  }, [designPreview, initial, navigation]);

  useEffect(() => {
    if (designPreview || locked.current) return;
    for (const index of [selected - 1, selected + 1]) {
      if (navigation?.hrefs[index] && !cache.current?.has(index)) void read(index);
    }
    if (lastChecked.current !== selected) {
      lastChecked.current = selected;
      void read(selected, true); // Quiet signed revalidation, never a page navigation.
    }
  }, [selected, designPreview, navigation, read]);
  useEffect(() => {
    if (designPreview) return;
    const check = () => { if (!document.hidden) void read(selectedRef.current, true); };
    document.addEventListener("visibilitychange", check);
    window.addEventListener("pageshow", check);
    return () => { document.removeEventListener("visibilitychange", check); window.removeEventListener("pageshow", check); };
  }, [designPreview, read]);

  function choose(index: number, settled: () => void) {
    const href = navigation?.hrefs[index];
    if (!href || locked.current || (isLoaded && (!userId || actor.current !== undefined && actor.current !== userId))) { settled(); return; }
    const activate = (value: ReadyTicket | null) => {
      if (!alive.current) return;
      settled();
      if (!value || locked.current) { setMessage("No hemos podido abrir esa entrada. Comprueba tu conexión y vuelve a intentarlo."); return; }
      selectedRef.current = index; setSelected(index); setMessage(null);
      // Supported native History integration: bookmarkable URL, no RSC/page loader.
      window.history.replaceState(null, "", href);
    };
    const ready = cache.current?.get(index);
    if (ready) activate(ready);
    else void read(index).then(value => { if (value) lastChecked.current = index; activate(value); });
  }
  const sameActor = !isLoaded || actor.current === undefined || actor.current === userId;
  const readable = sameActor && !locked.current && (!isLoaded || !!userId);
  const active = readable ? cache.current.get(selected) : undefined;
  const card = (entry: ReadyTicket | undefined, isActive: boolean) => entry
    ? <OwnedTicketCard key={entry.ticket.id} result={entry} designPreview={designPreview} active={isActive} /> : null;
  const actions = active && (designPreview || active.ticket.status === "valid" && active.ticket.qrDataUrl)
    ? <OwnedTicketActions key={active.ticket.id} ticketId={active.ticket.id} technical={active.technical} designPreview={designPreview} cardLayout /> : null;
  return <TicketPager navigation={readable && navigation ? { ...navigation, current: selected } : null} onSelect={choose}
    previous={card(readable ? cache.current.get(selected - 1) : undefined, false)} next={card(readable ? cache.current.get(selected + 1) : undefined, false)} actions={<>
      {actions}{message && <p role="status" className="diwo-ticket-action-feedback">{message}</p>}
    </>}>
    {card(active, true) ?? <p role="alert" className="diwo-ticket-unavailable">No podemos mostrar una entrada sin verificar sus datos. Actualiza la página para volver a comprobarlos.</p>}
  </TicketPager>;
}
