import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test, after } from "node:test";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as requestState from "../lib/order-request-state.ts";

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const originalFetch = globalThis.fetch;
const originalDocument = globalThis.document;
after(() => {
  if (originalStorage) Object.defineProperty(globalThis, "sessionStorage", originalStorage);
  else delete globalThis.sessionStorage;
  globalThis.fetch = originalFetch;
  if (originalDocument) globalThis.document = originalDocument;
  else delete globalThis.document;
});
function load(path, dependencies) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const container = { exports: {} };
  new Function("require", "module", "exports", compiled)(name => {
    if (name === "react/jsx-runtime") return jsx;
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  }, container, container.exports);
  return container.exports;
}
function nodes(node) {
  if (!node || typeof node !== "object") return [];
  if (typeof node.type === "function") return nodes(node.type(node.props));
  return [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];
}
function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (typeof node === "object") return typeof node.type === "function" ? text(node.type(node.props)) : text(node.props?.children);
  return String(node);
}
const icons = Object.fromEntries(["ArrowLeft", "ArrowRight", "CalendarDays", "Check", "Minus", "Plus", "Ticket", "Users", "UserRound", "MapPin"].map(name => [name, "svg"]));
const eventId = "16687b25-168c-42dc-88ae-e27a34b3238e";
const { OrderSummary } = load("../components/order-summary.tsx", {});
function harness() {
  let slots = [], index = 0, effects = [], dirty = false, previousKey;
  const state = { userId: "user_one", loaded: true, profileLoaded: true,
    user: { id: "user_one", firstName: "Ana", lastName: "García" },
    props: { availability: { state: "open", eventId, remainingTickets: 17 }, previewAllowed: false, phone: null },
     storage: new Map(), writes: [], requests: [], routes: [], refreshes: 0, blocked: false, focused: null };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: key => { if (state.blocked) throw new Error("blocked"); return state.storage.get(key) ?? null; },
    setItem: (key, value) => { if (state.blocked) throw new Error("blocked"); state.storage.set(key, value); state.writes.push([key, value]); },
    removeItem: key => { if (state.blocked) throw new Error("blocked"); state.storage.delete(key); },
  } });
  globalThis.document = { getElementById: id => ({ focus() { state.focused = id; } }) };
  globalThis.fetch = async (url, options) => {
    state.requests.push([url, options]);
    assert.equal([...state.storage.values()].includes(options.body), true, "Payload must be persisted before sending");
    throw new Error("synthetic ambiguous response");
  };
  const react = {
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? initial() : initial;
      return [slots[slot], update => { const next = typeof update === "function" ? update(slots[slot]) : update; if (!Object.is(next, slots[slot])) { slots[slot] = next; dirty = true; } }];
    },
    useRef(initial) { const slot = index++; return slots[slot] ?? (slots[slot] = { current: initial }); },
    useEffect(callback, deps) {
      const slot = index++, previous = slots[slot];
      if (!previous || deps.some((value, position) => !Object.is(value, previous[position]))) effects.push(callback);
      slots[slot] = deps;
    },
  };
  const Form = load("../components/order-request-form.tsx", {
    "@/components/buyer-flow-link": { BuyerFlowLink: "a" },
    react, "@clerk/nextjs": { useAuth: () => ({ userId: state.userId, isLoaded: state.loaded }), useUser: () => ({ user: state.user, isLoaded: state.profileLoaded }) },
    "next/navigation": { useRouter: () => ({ replace: path => state.routes.push(path), refresh: () => { state.refreshes++; } }) },
    "next/link": { default: "a" }, "next/image": { default: "img" }, "lucide-react": icons,
    "@/components/ui/button": { Button: "button" }, "@/components/order-payment-details": { OrderPaymentDetails: "payment-details" },
    "@/components/order-summary": { OrderSummary },
    "@/components/animated-attendee-row": { AnimatedAttendeeRow: ({ children, exiting, onExited }) => jsx.jsx("div", { "data-exiting": exiting, "data-exit": onExited, "aria-hidden": exiting || undefined, children }) },
    "@/lib/order-request-state": requestState,
  }).OrderRequestForm;
  function render() {
    let result;
    for (let attempt = 0; attempt < 8; attempt++) {
      const child = Form(state.props);
      if (previousKey !== child.key) { slots = []; previousKey = child.key; }
      index = 0; effects = []; dirty = false;
      result = child.type(child.props);
      effects.forEach(effect => effect());
      if (!dirty) return result;
    }
    throw new Error("Effects did not settle");
  }
  const find = predicate => { const result = nodes(render()).find(predicate); assert.ok(result, "Expected rendered control"); return result; };
  const input = id => find(node => node.props?.id === id && node.type === "input");
  const button = label => find(node => node.type === "button" && node.props?.["aria-label"] === label);
  const submit = () => find(node => node.type === "form").props.onSubmit({ preventDefault() {} });
  return { state, render, find, input, button, submit, remount() { slots = []; previousKey = undefined; return render(); } };
}

test("request prefill uses only the current account name and never overwrites manual edits, including an empty edit", () => {
  const h = harness();
  assert.equal(h.input("attendee-0").props.value, "Ana García");
  assert.equal(nodes(h.render()).some(node => node.props?.id === "buyer-name"), false);
  h.input("attendee-0").props.onChange({ target: { value: "First attendee buyer" } });
  h.state.user = { ...h.state.user, firstName: "Changed" };
  assert.equal(h.input("attendee-0").props.value, "First attendee buyer");
  h.input("attendee-0").props.onChange({ target: { value: "" } });
  assert.equal(h.input("attendee-0").props.value, "");
  assert.equal(h.state.requests.length, 0);
});
test("same-account rerenders retain edited attendees without storage writes or automatic submission", () => {
  const h = harness();
  h.input("attendee-0").props.onChange({ target: { value: "Manual buyer" } });
  h.button("Añadir una entrada").props.onClick();
  h.input("attendee-1").props.onChange({ target: { value: "Manual guest" } });
  h.state.props = { ...h.state.props, availability: { ...h.state.props.availability } };
  h.render();
  assert.equal(h.input("attendee-0").props.value, "Manual buyer");
  assert.equal(h.input("attendee-1").props.value, "Manual guest");
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.requests.length, 0);
});

test("selector caps at remaining places, including rapid clicks, and follows changing availability rather than a fixed 17", async () => {
  const h = harness();
  assert.doesNotMatch(text(h.render()), /No puedes añadir más entradas|Puedes solicitar hasta|reservan plaza/);
  const add = h.button("Añadir una entrada").props.onClick;
  for (let i = 0; i < 30; i++) add();
  assert.equal(nodes(h.render()).filter(node => node.type === "input").length, 17);
  assert.equal(h.button("Añadir una entrada").props.disabled, true);
  const warning = h.find(node => node.type === "p" && node.props.role === "status" && text(node).includes("No puedes añadir más entradas"));
  assert.equal(text(warning), "No puedes añadir más entradas: se supera el aforo máximo establecido.");
  assert.match(warning.props.className, /text-red-400/);
  assert.doesNotMatch(text(h.render()), /Puedes solicitar hasta|17 entradas|reservan plaza/);
  h.button("Quitar una entrada").props.onClick();
  assert.doesNotMatch(text(h.render()), /No puedes añadir más entradas/);
  h.button("Añadir una entrada").props.onClick();
  h.state.props.availability.remainingTickets = 1;
  assert.equal(h.button("Añadir una entrada").props.disabled, true);
  assert.equal(h.find(node => node.type === "button" && node.props.type === "submit").props.disabled, true);
  await h.submit(); assert.equal(h.state.requests.length, 0);
  for (let i = 0; i < 16; i++) h.button("Quitar una entrada").props.onClick();
  assert.equal(h.find(node => node.type === "button" && node.props.type === "submit").props.disabled, false);
  h.state.props.availability.remainingTickets = 0;
  assert.match(text(h.render()), /Solicitudes de entradas cerradas/);
  assert.equal(nodes(h.render()).some(node => node.type === "form"), false);
  assert.equal(h.state.requests.length, 0); assert.equal(h.state.writes.length, 0);
});

test("a saved ambiguous request can replay at full capacity without changing its ID or payload", async () => {
  const h = harness(); await h.submit();
  const original = h.state.requests[0][1].body;
  h.state.props.availability.remainingTickets = 0;
  h.remount();
  assert.equal(h.find(node => node.type === "button" && node.props.type === "submit").props.disabled, false);
  await h.submit(); assert.equal(h.state.requests[1][1].body, original);
});

test("a stale open page receiving sales_closed hides the form and never retries or replaces the saved payload", async () => {
  const h = harness(); h.render();
  globalThis.fetch = async (url, options) => {
    h.state.requests.push([url, options]);
    return Response.json({ error: "sales_closed" }, { status: 409 });
  };
  await h.submit();
  assert.match(text(h.render()), /Solicitudes de entradas cerradas/);
  assert.equal(nodes(h.render()).some(node => node.type === "form"), false);
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.storage.size, 1);
});

test("only an explicit action after definitive capacity rejection releases the draft for editing", async () => {
  const h = harness(); h.render();
  globalThis.fetch = async (url, options) => {
    h.state.requests.push([url, options]);
    return Response.json({ error: "event_capacity_exceeded" }, { status: 409 });
  };
  await h.submit(); const original = h.state.requests[0][1].body;
  assert.equal(h.state.storage.size, 1);
  assert.equal(h.input("attendee-0").props.disabled, true);
  assert.match(text(h.render()), /No se ha creado este pedido/);
  h.find(node => node.type === "button" && text(node) === "Actualizar disponibilidad y revisar cantidad").props.onClick();
  assert.equal(h.state.storage.size, 0); assert.equal(h.state.refreshes, 1);
  assert.equal(h.input("attendee-0").props.disabled, false);
  assert.equal(h.state.requests.length, 1);
  await h.submit(); assert.notEqual(JSON.parse(h.state.requests[1][1].body).requestId, JSON.parse(original).requestId);
});

test("removing an animated attendee immediately changes validation, quantity and payload; only a non-input snapshot remains", async () => {
  const h = harness();
  h.button("Añadir una entrada").props.onClick();
  h.input("attendee-1").props.onChange({ target: { value: "Removed guest" } });
  h.button("Quitar una entrada").props.onClick();
  const all = nodes(h.render());
  assert.equal(all.filter(node => node.type === "input").length, 1);
  assert.equal(text(all.find(node => node.type === "output")), "1");
  const ghost = all.find(node => node.props?.["data-exiting"]);
  assert.equal(ghost.props["aria-hidden"], true);
  assert.match(text(ghost), /Removed guest/);
  assert.equal(nodes(ghost).some(node => node.type === "input" || node.props?.htmlFor), false);
  await h.submit();
  assert.deepEqual(JSON.parse(h.state.requests[0][1].body).attendeeNames, ["Ana García"]);
  ghost.props["data-exit"]();
  assert.equal(nodes(h.render()).some(node => node.props?.["data-exiting"]), false);
});

test("rapid +/- changes keep remaining names, remove obsolete snapshots and never duplicate live field IDs", () => {
  const h = harness();
  h.button("Añadir una entrada").props.onClick();
  h.input("attendee-1").props.onChange({ target: { value: "Second" } });
  h.button("Añadir una entrada").props.onClick();
  h.input("attendee-2").props.onChange({ target: { value: "Third" } });
  h.button("Quitar una entrada").props.onClick();
  h.button("Quitar una entrada").props.onClick();
  assert.equal(nodes(h.render()).filter(node => node.props?.["data-exiting"]).length, 2);
  h.button("Añadir una entrada").props.onClick();
  const all = nodes(h.render()), inputs = all.filter(node => node.type === "input");
  assert.deepEqual(inputs.map(node => node.props.id), ["attendee-0", "attendee-1"]);
  assert.deepEqual(inputs.map(node => node.props.value), ["Ana García", ""]);
  assert.equal(h.state.requests.length, 0);
  assert.equal(h.state.writes.length, 0);
});
test("late profile loads prefill untouched forms, but mismatched accounts and missing profiles cannot provide a buyer name", () => {
  const h = harness(); h.state.profileLoaded = false;
  assert.equal(h.input("attendee-0").props.value, "");
  h.state.profileLoaded = true;
  assert.equal(h.input("attendee-0").props.value, "Ana García");
  h.state.userId = "user_two";
  assert.equal(h.input("attendee-0").props.value, "");
  h.state.user = { id: "user_two", firstName: null, lastName: null };
  assert.equal(h.input("attendee-0").props.value, "");
  const manual = harness(); manual.state.profileLoaded = false;
  manual.input("attendee-0").props.onChange({ target: { value: "Manual buyer" } });
  manual.state.profileLoaded = true;
  assert.equal(manual.input("attendee-0").props.value, "Manual buyer");
});
test("request reference presents the supplied poster, 2026 date, quantity controls and calculated five-euro totals", () => {
  const h = harness();
  assert.equal(h.find(node => node.type === "img").props.src, "/foto-de-perfil-wpp.jpg");
  assert.ok(text(h.render()).includes("2026"));
  assert.equal(h.find(node => node.props?.id === "quantity-heading").props.children, "¿Cuántas entradas?");
  assert.equal(text(h.render()).includes("Selecciona el número de entradas totales"), false);
  assert.equal(h.button("Quitar una entrada").props.disabled, true);
  h.input("attendee-0").props.onChange({ target: { value: "First attendee" } });
  h.button("Añadir una entrada").props.onClick();
  assert.equal(h.input("attendee-0").props.value, "First attendee");
  assert.equal(h.input("attendee-1").props.required, true);
  assert.ok(text(h.render()).includes("10,00"));
  assert.ok(text(h.render()).includes("REALIZAR SOLICITUD DE ENTRADAS"));
  assert.equal(h.find(node => node.props?.id === "attendees-help").props.children,
    "Introduce el nombre y apellidos de cada asistente (Obligatorio)");
  const labels = nodes(h.render()).filter(node => node.type === "label");
  assert.match(text(labels.find(node => node.props.htmlFor === "attendee-0")), /Asistente\s+1\s*\(comprador\)/);
  assert.equal(nodes(labels.find(node => node.props.htmlFor === "attendee-0")).find(node => node.type === "strong").props.className,
    "diwo-request-buyer-tag");
  assert.equal(text(labels.find(node => node.props.htmlFor === "attendee-1")).includes("comprador"), false);
  for (const removed of ["El comprador", "Un único Bizum", "Te esperamos entre", "Podrás compartir", "Tus amigos no necesitan"]) {
    assert.equal(text(h.render()).includes(removed), false, removed);
  }
  h.button("Quitar una entrada").props.onClick();
  assert.equal(h.input("attendee-0").props.value, "First attendee");
  assert.equal(h.state.requests.length, 0);
});
test("quantity label shares a responsive row with usable 44-pixel stepper targets instead of forcing a wrapped selector", () => {
  const css = readFileSync(new URL("../components/ticket-request.css", import.meta.url), "utf8");
  const quantity = css.match(/\.diwo-request-quantity\s*\{([^}]+)\}/)?.[1];
  assert.match(quantity, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(quantity, /align-items:\s*center/);
  assert.match(css, /\.diwo-request-step\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/);
});
test("saved submissions win over profile changes and retries preserve the exact UUID and body", async () => {
  const h = harness();
  h.input("attendee-0").props.onChange({ target: { value: "First attendee" } });
  await h.submit();
  assert.equal(h.state.requests.length, 1);
  const original = h.state.requests[0][1].body;
  assert.equal(JSON.parse(original).buyerName, "First attendee");
  assert.equal(JSON.parse(original).buyerName, JSON.parse(original).attendeeNames[0]);
  h.state.user = { ...h.state.user, firstName: "Changed" };
  assert.equal(h.input("attendee-0").props.value, "First attendee");
  assert.equal(h.input("attendee-0").props.disabled, true);
  await h.submit();
  assert.equal(h.state.requests[1][1].body, original);
  const restored = harness();
  restored.state.storage.set(`diwo.order-submission.v1.user_one.${eventId}`, original);
  restored.state.user = { ...restored.state.user, firstName: "Changed" };
  assert.equal(restored.input("attendee-0").props.value, "First attendee");
  assert.equal(restored.input("attendee-0").props.disabled, true);
});
test("legacy saved request with a separate buyer retains exact payload and explicitly explains its original buyer", async () => {
  const h = harness();
  const saved = JSON.stringify({ requestId: "00000000-0000-4000-8000-000000000001", eventId,
    buyerName: "Original payer", attendeeNames: ["Original attendee"] });
  h.state.storage.set(`diwo.order-submission.v1.user_one.${eventId}`, saved);
  assert.equal(h.input("attendee-0").props.value, "Original attendee");
  assert.equal(h.input("attendee-0").props.disabled, true);
  assert.ok(text(h.render()).includes("Original payer"));
  await h.submit();
  assert.equal(h.state.requests[0][1].body, saved);
});
test("closed sales, unavailable storage and invalid names still reject without a write; admin preview never posts", async () => {
  for (const availability of ["unpublished", "unavailable"]) {
    const h = harness(); h.state.props.availability = { state: availability, eventId: null };
    h.input("attendee-0").props.onChange({ target: { value: "Attendee" } });
    assert.equal(text(h.render()).includes("Venta en preparación"), false);
    await h.submit(); assert.equal(h.state.requests.length, 0); assert.equal(h.state.writes.length, 0);
  }
  const blocked = harness(); blocked.state.blocked = true;
  await blocked.submit(); assert.equal(blocked.state.requests.length, 0);
  const missing = harness(); missing.input("attendee-0").props.onChange({ target: { value: "" } }); await missing.submit();
  assert.equal(missing.state.focused, "attendee-0"); assert.equal(missing.state.requests.length, 0);
  const preview = harness(); preview.state.props = { ...preview.state.props, availability: { state: "unpublished", eventId: null }, previewAllowed: true };
  preview.input("attendee-0").props.onChange({ target: { value: "Attendee" } });
  await preview.submit();
  assert.deepEqual(preview.state.routes, ["/ticket/payment/preview?quantity=1"]);
  assert.equal(preview.state.requests.length, 0); assert.equal(preview.state.writes.length, 0);
});
test("persistent payment route opens only after a validated same-request pending receipt, never after an ambiguous or malformed response", async () => {
  for (const valid of [true, false]) {
    const h = harness(); h.render();
    globalThis.fetch = async (_url, options) => {
      assert.ok([...h.state.storage.values()].includes(options.body));
      const draft = JSON.parse(options.body);
      return { ok: true, json: async () => ({ order: { id: draft.requestId, reference: "DIWO-ABCDEF123456", status: "pending",
        quantity: valid ? draft.attendeeNames.length : 999, totalCents: 500 } }) };
    };
    await h.submit();
    assert.equal(h.state.routes.length, valid ? 1 : 0);
    if (valid) {
      const saved = JSON.parse(h.state.writes.at(-1)[1]);
      assert.equal(h.state.storage.size, 0, "Verified receipts must release the completed draft");
      assert.equal(h.state.routes[0], `/ticket/payment/${saved.requestId}`);
      assert.match(text(h.render()), /Solicitud enviada correctamente/);
      assert.equal(h.find(node => node.type === "a").props.href, h.state.routes[0]);
      assert.equal(nodes(h.render()).some(node => node.type === "form"), false);
    } else assert.equal(h.state.storage.size, 1, "Malformed success cannot resolve an uncertain submission");
  }
});

test("a verified submission is finished: returning for another request starts with one editable attendee and a new ID, without an automatic POST", async () => {
  const h = harness(); h.input("attendee-0").props.onChange({ target: { value: "Previous buyer" } });
  h.button("Añadir una entrada").props.onClick();
  h.input("attendee-1").props.onChange({ target: { value: "Previous guest" } });
  globalThis.fetch = async (url, options) => {
    assert.equal(h.state.storage.get(`diwo.order-submission.v1.user_one.${eventId}`), options.body);
    h.state.requests.push([url, options]); const draft = JSON.parse(options.body);
    return Response.json({ order: { id: draft.requestId, reference: "DIWO-ABCDEF123456", status: "pending",
      quantity: draft.attendeeNames.length, totalCents: draft.attendeeNames.length * 500 } });
  };
  await h.submit(); const first = JSON.parse(h.state.requests[0][1].body);
  assert.equal(h.state.storage.size, 0); assert.equal(h.state.requests.length, 1);
  h.remount();
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.input("attendee-0").props.value, "Ana García"); assert.equal(h.input("attendee-0").props.disabled, false);
  assert.equal(nodes(h.render()).filter(node => node.type === "input").length, 1);
  assert.equal(h.button("Añadir una entrada").props.disabled, false);
  assert.match(text(h.render()), /REALIZAR SOLICITUD DE ENTRADAS/);
  assert.doesNotMatch(text(h.render()), /REINTENTAR|Previous guest/);
  await h.submit(); const second = JSON.parse(h.state.requests[1][1].body);
  assert.notEqual(second.requestId, first.requestId);
  assert.deepEqual(second.attendeeNames, ["Ana García"]);
});

test("rejected or ambiguous replies keep the exact submission through remount; no automatic new identifier", async () => {
  for (const result of ["network", "denied", "wrong_id", "malformed"]) {
    const h = harness(); h.render();
    globalThis.fetch = async (_url, options) => {
      h.state.requests.push([_url, options]); const draft = JSON.parse(options.body);
      if (result === "network") throw new Error("synthetic_network_failure");
      if (result === "denied") return Response.json({ error: "operation_not_authorized" }, { status: 403 });
      return Response.json({ order: { id: result === "wrong_id" ? "wrong" : draft.requestId, reference: "DIWO-ABCDEF123456",
        status: "pending", quantity: result === "malformed" ? 999 : 1, totalCents: 500 } });
    };
    await h.submit(); const original = h.state.requests[0][1].body;
    h.remount(); assert.equal(h.input("attendee-0").props.disabled, true);
    assert.equal(h.button("Añadir una entrada").props.disabled, true);
    await h.submit(); assert.equal(h.state.requests[1][1].body, original);
    assert.equal(h.state.storage.get(`diwo.order-submission.v1.user_one.${eventId}`), original);
  }
});

test("receipt cleanup never deletes another account/event or a different in-flight draft", async () => {
  for (const replaceCurrent of [false, true]) {
    const h = harness(); h.render();
    h.state.storage.set(`diwo.order-submission.v1.user_other.${eventId}`, "other-account");
    h.state.storage.set("diwo.order-submission.v1.user_one.other-event", "other-event");
    const replacement = "another-submission";
    globalThis.fetch = async (_url, options) => {
      const draft = JSON.parse(options.body);
      if (replaceCurrent) h.state.storage.set(`diwo.order-submission.v1.user_one.${eventId}`, replacement);
      return Response.json({ order: { id: draft.requestId, reference: "DIWO-ABCDEF123456", status: "pending", quantity: 1, totalCents: 500 } });
    };
    await h.submit();
    assert.equal(h.state.storage.get(`diwo.order-submission.v1.user_other.${eventId}`), "other-account");
    assert.equal(h.state.storage.get("diwo.order-submission.v1.user_one.other-event"), "other-event");
    assert.equal(h.state.storage.get(`diwo.order-submission.v1.user_one.${eventId}`), replaceCurrent ? replacement : undefined);
  }
});
test("empty-ticket reference appears only on a successful zero-order read, never on error or pending/history", async () => {
  const { ConfirmedOrderCard } = load("../components/confirmed-order-card.tsx", {
    "next/link": { default: "a" }, "lucide-react": { ...icons, CircleCheck: "svg", CircleX: "svg", Clock3: "svg" },
  });
  const { TicketsHeading } = load("../components/tickets-heading.tsx", {});
  const { CancelledOrderCard } = load("../components/cancelled-order-card.tsx", { "lucide-react": { CircleX: "svg" } });
  const { PendingOrderCard } = load("../components/pending-order-card.tsx", {
    "next/link": { default: "a" }, "next/image": { default: "img" }, "lucide-react": { ArrowRight: "svg", Clock3: "svg", Hourglass: "svg" },
  });
  let result = { ok: true, orders: [] };
  const Empty = load("../components/empty-tickets.tsx", {
    "next/link": { default: "a" }, "lucide-react": icons,
    "@/components/tickets-heading": { TicketsHeading },
  }).EmptyTickets;
  const Page = load("../app/ticket/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "user_one" }) },
    "next/navigation": { redirect: path => { throw new Error(path); } }, "next/link": { default: "a" },
    "@/components/ui/button": { Button: "button" }, "@/lib/local-access": { hasConfiguredClerkKeys: () => true },
    "@/lib/order-reads": { readOrderOverview: async scope => { assert.equal(scope, "buyer"); return result; } },
    "@/lib/order-payment-state": { paymentPhone: () => null },
    "@/components/order-payment-details": { OrderPaymentDetails: "payment-details" },
    "@/components/refresh-orders": { RefreshOrders: "refresh-control" }, "@/components/new-order-link": { NewOrderLink: "new-order-link" },
    "@/components/empty-tickets": { EmptyTickets: Empty },
    "@/components/tickets-heading": { TicketsHeading }, "@/components/pending-order-card": { PendingOrderCard },
    "@/components/confirmed-order-card": { ConfirmedOrderCard },
    "@/components/cancelled-order-card": { CancelledOrderCard },
  }).default;
  const emptyView = await Page();
  assert.ok(text(emptyView).includes("Todavía no tienes entradas"));
  assert.ok(text(emptyView).includes("Puedes solicitar tus entradas desde Inicio."));
  assert.equal(nodes(emptyView).some(node => node.type === "refresh-control"), false);
  assert.equal(nodes(emptyView).some(node => node.type === "a"), false);
  const emptyCard = nodes(emptyView).find(node => node.props?.className === "diwo-tickets-empty-card");
  const cardChildren = emptyCard.props.children;
  assert.equal(cardChildren[1].type, "p");
  assert.equal(cardChildren[2].props.className, "diwo-tickets-empty-icon");
  assert.equal(cardChildren[2].props["aria-hidden"], "true");
  const styles = readFileSync(new URL("../components/ticket-request.css", import.meta.url), "utf8");
  assert.match(styles, /\.diwo-tickets-empty-card h2\s*\{[^}]*font-weight:\s*700/);
  result = { ok: false };
  assert.ok(nodes(await Page()).some(node => node.props?.role === "alert"));
  assert.equal(text(await Page()).includes("Todavía no tienes entradas"), false);
  for (const status of ["pending", "confirmed", "cancelled", "rejected"]) {
    result = { ok: true, orders: [{ id: "order", eventId, reference: "TECHNICAL", eventTitle: "Technical", names: ["Synthetic"], quantity: 1, totalCents: 500, status, reportedAt: null, actualEvent: false, technical: true, tickets: [] }] };
    const view = await Page();
    assert.equal(text(view).includes("Todavía no tienes entradas"), false);
    assert.ok(text(view).includes("Prueba técnica conservada"));
  }
});
