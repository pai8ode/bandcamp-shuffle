// Drive Firefox over WebDriver BiDi (port 9223). Use "chrome:" as the first
// argument to evaluate in the privileged browser window instead of a page.
// Usage: node bidi.mjs <url-substring|chrome:> <js expression | sleep:ms>...
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
