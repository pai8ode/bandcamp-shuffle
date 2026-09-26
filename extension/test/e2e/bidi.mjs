// Drive Firefox over WebDriver BiDi (port 9223). Use "chrome:" as the first
// argument to evaluate in the privileged browser window instead of a page.
// Usage: node bidi.mjs <url-substring|chrome:> <js expression | sleep:ms | nav:url | click:selector | shot:path>...
const [match, ...steps] = process.argv.slice(2);
const ws = new WebSocket("ws://127.0.0.1:9223/session");
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id) pending.get(m.id)?.(m); };
const call = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const session = await call("session.new", { capabilities: {} });
try {
  if (session.type === "error") throw new Error(session.message);
  const chrome = match === "chrome:";
  const tree = await call("browsingContext.getTree", chrome ? { "moz:scope": "chrome" } : {});
  const ctx = chrome ? tree.result.contexts[0] : tree.result.contexts.find((c) => c.url.includes(match));
  if (!ctx) throw new Error(`no context; have: ${tree.result.contexts.map((c) => c.url)}`);
  for (const step of steps) {
    if (step.startsWith("sleep:")) { await new Promise((r) => setTimeout(r, +step.slice(6))); continue; }
    if (step.startsWith("click:")) {
      // A real mouse click (with user activation) on the first element matching the selector.
      const where = await call("script.evaluate", {
        expression: `(() => { const e = document.querySelector(${JSON.stringify(step.slice(6))}); if (!e) return "null"; e.scrollIntoView({ block: "center" }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()`,
        target: { context: ctx.context }, awaitPromise: false,
      });
      const point = JSON.parse(where.result?.result?.value ?? "null");
      if (!point) { console.log("click: no element"); continue; }
      await call("input.performActions", { context: ctx.context, actions: [{ type: "pointer", id: "mouse", actions: [
        { type: "pointerMove", x: point.x, y: point.y }, { type: "pointerDown", button: 0 }, { type: "pointerUp", button: 0 },
      ] }] });
      console.log("clicked", JSON.stringify(point));
      continue;
    }
    if (step.startsWith("shot:")) {
      const r = await call("browsingContext.captureScreenshot", { context: ctx.context });
      if (r.type === "error") { console.log("screenshot error:", r.message); continue; }
      (await import("node:fs")).writeFileSync(step.slice(5), Buffer.from(r.result.data, "base64"));
      console.log("saved", step.slice(5));
      continue;
    }
    if (step.startsWith("nav:")) {
      const r = await call("browsingContext.navigate", { context: ctx.context, url: step.slice(4), wait: "none" });
      console.log(r.type === "error" ? `navigate error: ${r.message}` : "navigated");
      continue;
    }
    const r = await call("script.evaluate", { expression: `(async () => JSON.stringify(await (${step})))()`, target: { context: ctx.context }, awaitPromise: true });
    console.log(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? JSON.stringify(r).slice(0, 300));
  }
} catch (err) {
  console.log("error:", err.message);
  process.exitCode = 1;
} finally {
  await call("session.end");
  ws.close();
}
