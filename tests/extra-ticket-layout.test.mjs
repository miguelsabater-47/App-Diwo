import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import * as icons from "lucide-react";

const chrome = process.env.DIWO_LAYOUT_CHROME;
function load(path, dependencies) {
  const mod = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name];
  }, mod, mod.exports);
  return mod.exports;
}
function fixture(kind, mode) {
  let reactMode = "list", reactKind = "general";
  const react = {
    useState(initial) {
      const value = typeof initial === "function" ? initial() : initial;
      return [value === "list" ? reactMode : value === "general" ? reactKind : value, () => {}];
    },
    useRef: value => ({ current: value }), useEffect() {},
  };
  const auth = { useAuth: () => ({ userId: "user_layout_fixture", isLoaded: true }) };
  const adminModel = { filterAdminTickets: rows => rows, revokedTicketReceipt: () => null };
  const general = load("../components/admin-tickets.tsx", { react, "@clerk/nextjs": auth, "lucide-react": icons,
    "@/lib/admin-ticket-model": adminModel, "@/components/admin-ticket-list-item": { AdminTicketListItem: () => null } });
  const workspace = load("../components/admin-ticket-workspace.tsx", { react, "@clerk/nextjs": auth, "lucide-react": icons,
    "@/components/admin-tickets": { AdminTickets(props) { reactMode = "list"; reactKind = "general"; return general.AdminTickets(props); } },
    "@/components/admin-ticket-list-item": { AdminTicketListItem: () => null },
    "@/components/animated-attendee-row": { AnimatedAttendeeRow: ({ children }) => jsx.jsx("div", { children }) },
    "@/components/admin-extra-ticket-detail": { AdminExtraTicketDetail: () => null }, "@/lib/admin-ticket-model": adminModel,
    "@/lib/extra-ticket-model": {}, "@/lib/request-deadline": {},
  });
  reactMode = mode; reactKind = kind;
  return renderToStaticMarkup(jsx.jsx(workspace.AdminTicketWorkspace, { tickets: [], extras: [] }));
}

for (const width of [390, 1280]) test(`real extra controls have separated filter rows and centered icons at ${width}px`, {
  skip: !chrome || !existsSync(chrome) ? "Set DIWO_LAYOUT_CHROME to run isolated rendered Chromium checks" : false,
}, () => {
  // Fresh temporary profile and static component fixtures only: no application
  // service, credentials, real data, session reuse or network requests.
  const directory = mkdtempSync(join(tmpdir(), "opencode", "diwo-extra-layout-"));
  try {
    const css = ["admin-requests.css", "admin-tickets.css", "ticket-request.css"].map(name =>
      readFileSync(new URL(`../components/${name}`, import.meta.url), "utf8")).join("\n");
    const file = join(directory, "layout.html");
    const content = `<!doctype html><html><head><meta charset="utf-8"><style>
      *,*::before,*::after{box-sizing:border-box}body{margin:0;background:#000;font-family:Arial,sans-serif}
      button,input{font:inherit}button{cursor:pointer}h1,h2,p{margin:0}svg{display:block;vertical-align:middle}
      .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0}
      ${css}</style></head><body>
      <div id="general">${fixture("general", "list")}</div>
      <div id="extra">${fixture("extra", "list")}</div>
      <div id="create">${fixture("extra", "edit")}</div>
      <script>
        const gaps = ['general','extra'].map(id => {
          const root = document.getElementById(id);
          return root.querySelector('.diwo-admin-ticket-tabs').getBoundingClientRect().top - root.querySelector('.diwo-extra-types').getBoundingClientRect().bottom;
        });
        const offsets = [...document.querySelectorAll('#create .diwo-request-step')].map(button => {
          const a=button.getBoundingClientRect(), b=button.querySelector('svg').getBoundingClientRect();
          return {x:Math.abs(a.x+a.width/2-b.x-b.width/2),y:Math.abs(a.y+a.height/2-b.y-b.height/2),width:a.width,height:a.height};
        });
        const first=document.querySelector('#create .diwo-request-step:not(:disabled)');first.focus();
        parent.document.getElementById('layout-results').textContent=JSON.stringify({viewport:innerWidth,gaps,offsets,focused:document.activeElement===first,overflow:document.documentElement.scrollWidth>innerWidth});
      </script></body></html>`;
    // An exact-width same-origin frame avoids Chrome's native window minimum
    // width and Windows non-client border sizes distorting mobile measurements.
    const source = content.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    writeFileSync(file, `<!doctype html><html><body style="margin:0"><pre id="layout-results"></pre><iframe style="display:block;border:0;width:${width}px;height:1000px" srcdoc="${source}"></iframe></body></html>`);
    const result = spawnSync(chrome, ["--headless", "--no-first-run", "--disable-extensions", "--disable-background-networking",
      "--host-resolver-rules=MAP * ~NOTFOUND", `--user-data-dir=${join(directory, "profile")}`, `--window-size=${Math.max(800, width + 100)},1100`,
      "--dump-dom", pathToFileURL(file).href], { encoding: "utf8", timeout: 30000, windowsHide: true });
    assert.equal(result.status, 0, "Isolated Chromium completed");
    const match = /<pre id="layout-results">([^<]+)<\/pre>/.exec(result.stdout);
    assert.ok(match, "Rendered geometry was measured");
    const geometry = JSON.parse(match[1]);
    assert.equal(geometry.viewport, width, "Browser must use the requested viewport");
    assert.ok(geometry.gaps.every(gap => gap >= 20), `Category and status rows need breathing room: ${geometry.gaps}`);
    assert.equal(geometry.offsets.length, 2);
    for (const offset of geometry.offsets) {
      assert.ok(offset.x <= 1 && offset.y <= 1, `Icon must be centered: ${JSON.stringify(offset)}`);
      assert.equal(offset.width, 44); assert.equal(offset.height, 44);
    }
    assert.equal(geometry.focused, true); assert.equal(geometry.overflow, false);
  } finally { rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
});
