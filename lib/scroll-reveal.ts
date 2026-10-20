/** Observe explicit non-sensitive blocks only. Content is never hidden in CSS. */
export function startScrollReveal(root: HTMLElement, preference?: MediaQueryList) {
  if (preference?.matches || !window.IntersectionObserver) return () => {};
  const seen = new WeakSet<Element>(), pending = new Set<Element>(), animations = new Set<Animation>();
  let disposed = false;
  const observer = new window.IntersectionObserver(entries => {
    if (disposed || preference?.matches) return;
    for (const entry of entries) {
      if (!entry.isIntersecting || !pending.has(entry.target)) continue;
      observer.unobserve(entry.target); pending.delete(entry.target);
      if (!root.contains(entry.target) || !entry.target.animate) continue;
      try {
        const animation = entry.target.animate([
          { opacity: 0.65, transform: "translateY(10px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      } catch { /* Decorative only; leave the block visible. */ }
    }
  }, { threshold: 0.1, rootMargin: "0px 0px -24px 0px" });
  const register = (node: Element) => {
    if (!root.contains(node) || seen.has(node) || !node.matches("[data-scroll-reveal]")) return;
    seen.add(node);
    // Above-the-fold content already participates in the page entrance.
    if (node.getBoundingClientRect().top < window.innerHeight - 16) return;
    pending.add(node); observer.observe(node);
  };
  root.querySelectorAll("[data-scroll-reveal]").forEach(register);
  const additions = window.MutationObserver ? new window.MutationObserver(records => {
    if (disposed) return;
    for (const record of records) for (const node of record.addedNodes) {
      if (node.nodeType !== 1) continue;
      register(node as Element);
      (node as Element).querySelectorAll("[data-scroll-reveal]").forEach(register);
    }
    if (records.some(record => record.removedNodes.length)) {
      for (const node of pending) if (!root.contains(node)) { observer.unobserve(node); pending.delete(node); }
    }
  }) : null;
  additions?.observe(root, { childList: true, subtree: true });
  const stop = () => {
    disposed = true; observer.disconnect(); additions?.disconnect(); pending.clear();
    for (const animation of animations) { animation.onfinish = null; animation.cancel(); }
    animations.clear();
  };
  const reduce = () => { if (preference?.matches) stop(); };
  preference?.addEventListener?.("change", reduce);
  return () => { stop(); preference?.removeEventListener?.("change", reduce); };
}
