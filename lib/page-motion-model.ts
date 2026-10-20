export type MotionHistory = { paths: string[]; index: number; pop: boolean };
export type PageDirection = "initial" | "forward" | "back";

export const motionPath = (path: string) => path.replace(/\/+$/, "") || "/";
export function pageMotionEnabled(path: string) {
  return !(/^\/ticket\/[^/]+$/.test(path) && path !== "/ticket/preview") && !/^\/(?:admin\/)?scan(?:\/|$)/.test(path);
}

/** Route strings only: do not inspect/patch Next's history state or retain pages. */
export function advanceMotionHistory(history: MotionHistory, path: string): PageDirection {
  const previous = history.paths[history.index];
  if (!previous) { history.paths = [path]; history.index = 0; history.pop = false; return "initial"; }
  if (previous === path) { history.pop = false; return "initial"; }
  if (history.pop) {
    history.pop = false;
    const back = history.paths.lastIndexOf(path, history.index - 1);
    const forward = history.paths.indexOf(path, history.index + 1);
    if (history.index > 0 && back >= 0) { history.index = back; return "back"; }
    if (forward >= 0) { history.index = forward; return "forward"; }
    // A bookmarked route may precede the per-document record. Prefer a back
    // entrance for this unknown traversal, without changing browser history.
    history.paths = [path, ...history.paths].slice(0, 64); history.index = 0;
    return "back";
  }
  const tabs = ["/", "/ticket", "/account", "/admin", "/admin/requests", "/admin/scan", "/admin/tickets", "/admin/staff"];
  const from = tabs.indexOf(previous), to = tabs.indexOf(path);
  const back = from >= 0 && to >= 0 ? to < from : path.split("/").filter(Boolean).length < previous.split("/").filter(Boolean).length;
  history.paths = [...history.paths.slice(0, history.index + 1), path].slice(-64);
  history.index = history.paths.length - 1;
  return back ? "back" : "forward";
}
