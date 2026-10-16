/*
 * scripts/debug-harness.mjs — navigate the headless page to the client
 * harness and capture console errors + test log.
 */
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
const require = createRequire(join(homedir(), ".dsh", "profiles", "desktop", "package.json"));
const WebSocket = require("ws");

const LIST = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = LIST.find((t) => t.type === "page");
if (!page) { console.error("no page"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
let seq = 0; const pending = new Map(); const events = [];
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); return; }
  if (m.method === "Runtime.consoleAPICalled") {
    events.push(`[${m.params.type}] ` + (m.params.args || []).map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
  } else if (m.method === "Runtime.exceptionThrown") {
    const d = m.params.exceptionDetails;
    events.push("[EXC] " + (d.exception?.description || d.text || "").slice(0, 400));
  }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.on("open", async () => {
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: "http://127.0.0.1:8123/dsh-skin-matrix-rain/test/client-harness.html?v5" });
    await sleep(23000); /* 断雨宽限(1.2s)×多段等待,总时长约 21s */
    const log = (await send("Runtime.evaluate", { expression: "document.getElementById('log').textContent", returnByValue: true })).result.value;
    console.log("=== HARNESS LOG ===\n" + log);
    console.log("=== CONSOLE ===");
    events.forEach((e) => console.log(e));
    ws.close(); process.exit(0);
  } catch (e) { console.error("failed:", e.message); process.exit(1); }
});
setTimeout(() => { console.error("timeout"); process.exit(1); }, 60000);
