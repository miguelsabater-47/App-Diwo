export default function Loading() {
  return <section role="status" aria-live="polite" className="mx-auto min-h-[40dvh] w-full max-w-3xl px-5 py-7">
    <span className="sr-only">Cargando contenido…</span>
    <div aria-hidden="true" className="motion-safe:animate-pulse">
      <div className="mb-6 h-9 w-48 rounded-lg bg-zinc-800" />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map(key => <div key={key} className="rounded-2xl border border-zinc-800 bg-card p-6">
          <div className="mb-4 h-4 w-2/3 rounded bg-zinc-800" />
          <div className="h-16 rounded-lg bg-zinc-800/50" />
        </div>)}
      </div>
    </div>
  </section>;
}
