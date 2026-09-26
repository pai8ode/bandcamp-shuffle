// Drive a Chromium page over the DevTools protocol (port 9333).
// Usage: node cdp.mjs <url-substring|url> <js expression | sleep:ms | shot:path>...
import { writeFileSync } from "node:fs";
const [match, ...steps] = process.argv.slice(2);
const PORT = 9333;
const list = await (await fetch(`http://localhost:${PORT}/json/list`)).json();
let target = list.find((t) => t.url.includes(match));
if (!target && match.includes("://")) target = await (await fetch(`http://localhost:${PORT}/json/new?${match}`, { method: "PUT" })).json();
if (!target) { console.log("no target; have:", list.map((t) => t.url)); process.exit(1); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pending = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); });
const call = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
for (const step of steps) {
  if (step.startsWith("sleep:")) { await new Promise((r) => setTimeout(r, +step.slice(6))); continue; }
  if (step.startsWith("shot:")) { const r = await call("Page.captureScreenshot", { format: "png" }); writeFileSync(step.slice(5), Buffer.from(r.result.data, "base64")); console.log("saved", step.slice(5)); continue; }
  const r = await call("Runtime.evaluate", { expression: `(async () => JSON.stringify(await (${step})))()`, awaitPromise: true, returnByValue: true });
  console.log(r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? JSON.stringify(r));
}
ws.close();
