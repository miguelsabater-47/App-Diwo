/** Bounded browser requests without requiring newer AbortSignal.any/timeout APIs. */
export async function withRequestDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let abortReason: unknown;
  const abort = (reason: unknown) => { if (!controller.signal.aborted) { abortReason = reason; controller.abort(reason); } };
  const cancel = () => abort(parent?.reason ?? new DOMException("Request cancelled", "AbortError"));
  if (parent?.aborted) { cancel(); throw abortReason; }
  parent?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => abort(new DOMException("Request timed out", "TimeoutError")), milliseconds);
  try { return await operation(controller.signal); }
  catch (error) { throw controller.signal.aborted ? abortReason : error; }
  finally { clearTimeout(timer); parent?.removeEventListener("abort", cancel); }
}
