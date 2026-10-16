/*
 * scripts/capture.mjs — scenario-driven capture for the matrix-rain skin.
 *
 * Two capture modes:
 *   canvas — fast (~10fps): composite the rain canvas onto black, toDataURL,
 *            decode base64 over CDP. For rain/shock/rainbow/task demos.
 *   page   — slow (~0.7fps): full-viewport Page.captureScreenshot.
 *            For tint/settings demos where UI context matters.
 *
 * Usage: node scripts/capture.mjs <scenario> [durationSec]
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname as pdirname } from "node:path";
import { fileURLToPath as pfileURL } from "node:url";
const require = createRequire(join(homedir(), ".dsh", "profiles", "desktop", "package.json"));
const WebSocket = require("ws");

const scenario = process.argv[2] || "shock";
const durationSec = +(process.argv[3] || 4);
const OUT = pdirname(pdirname(pfileURL(import.meta.url))) + "/shots/" + scenario;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const CANVAS_SCENARIOS = new Set(["shock", "rainbow", "task", "hero"]);
const MODE = CANVAS_SCENARIOS.has(scenario) ? "canvas" : "page";
const INTERVAL = MODE === "canvas" ? 100 : 1400;

const LIST = await (await fetch("http://127.0.0.1:9223/json/list")).json();
const page = LIST.find((t) => t.type === "page" && (t.url || "").startsWith("http://127.0.0.1:3081"));
if (!page) { console.error("no pocket page — launch headless Edge on 9223 first"); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 512 * 1024 * 1024 });
let seq = 0; const pending = new Map();
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq; pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.on("message", (d) => {
  const m = JSON.parse(d.toString());
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: false });
  if (r.exceptionDetails) return "EXC: " + (r.exceptionDetails.exception?.description || "").slice(0, 200);
  return r.result.value;
}
let capturing = false, frameIdx = 0;

async function captureLoop() {
  while (capturing) {
    try {
      if (MODE === "canvas") {
        const url = await ev(`(function(){
          const src = document.querySelector('[data-skin-chrome="matrix-rain"]');
          if (!src || src.style.display === 'none') return '';
          const t = document.createElement('canvas');
          t.width = src.width; t.height = src.height;
          const g = t.getContext('2d');
          g.fillStyle = '#000'; g.fillRect(0, 0, t.width, t.height);
          g.drawImage(src, 0, 0);
          return t.toDataURL('image/jpeg', 0.85);
        })()`);
        if (typeof url === "string" && url.startsWith("data:image")) {
          const b64 = url.slice(url.indexOf(",") + 1);
          writeFileSync(`${OUT}/f${String(frameIdx++).padStart(4, "0")}.jpg`, Buffer.from(b64, "base64"));
        }
      } else {
        const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
        writeFileSync(`${OUT}/f${String(frameIdx++).padStart(4, "0")}.jpg`, Buffer.from(r.data, "base64"));
      }
    } catch (e) { /* 单帧失败忽略 */ }
    await sleep(INTERVAL);
  }
}

const SET_CFG = (over) => `(function(){
  const raw = localStorage.getItem('dsh-skin-matrix-rain:config:v1');
  const c = raw ? JSON.parse(raw) : {};
  Object.assign(c, ${JSON.stringify(over.base)});
  Object.assign(c, ${JSON.stringify(over)});
  localStorage.setItem('dsh-skin-matrix-rain:config:v1', JSON.stringify(c));
  window.dispatchEvent(new CustomEvent('dsh-matrix-rain:config'));
  return 'ok';
})()`;

const BASE_ALWAYS = { v: 4, master: true, timing: "always", tpsAdaptive: true, rainArea: "full", interactions: ["shock", "glow"] };

const SCENARIOS = {
  shock: {
    mode: "canvas",
    steps: [
      ["默认绿+常时+慢波", SET_CFG({ base: BASE_ALWAYS, palette: "classic-green", blend: "screen", speedMult: 1, shockSpeed: 15, density: 1, glyphScale: 1, opacity: 0.9 }), 1500],
      ["中心冲击波", `(function(){ window.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:innerWidth/2,clientY:innerHeight/2,bubbles:true})); return 'ok'; })()`, 3200],
      ["左上冲击波", `(function(){ window.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:innerWidth*0.25,clientY:innerHeight*0.3,bubbles:true})); return 'ok'; })()`, 3200],
      ["右下冲击波", `(function(){ window.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:innerWidth*0.78,clientY:innerHeight*0.75,bubbles:true})); return 'ok'; })()`, 3200],
    ],
  },
  rainbow: {
    mode: "canvas",
    steps: [
      ["彩虹+4x", SET_CFG({ base: BASE_ALWAYS, palette: "rainbow", blend: "screen", speedMult: 4, shockSpeed: 50, density: 1, glyphScale: 1, opacity: 0.95 }), 4000],
      ["彩虹冲击波", `(function(){ window.dispatchEvent(new PointerEvent('pointerdown',{button:0,clientX:innerWidth/2,clientY:innerHeight*0.5,bubbles:true})); return 'ok'; })()`, 3200],
    ],
  },
  hero: {
    mode: "canvas",
    steps: [
      ["默认绿全屏", SET_CFG({ base: BASE_ALWAYS, palette: "classic-green", blend: "screen", speedMult: 1, shockSpeed: 50, density: 1, glyphScale: 1, opacity: 0.85 }), 6000],
    ],
  },
  task: {
    mode: "canvas",
    steps: [
      ["仅任务模式待命", SET_CFG({ base: { ...BASE_ALWAYS, timing: "task" }, palette: "classic-green", blend: "screen", speedMult: 1, shockSpeed: 50, density: 1, glyphScale: 1, opacity: 0.85 }), 2500],
      ["等任务触发(本回合运行中)", "'wait'", 6000],
      ["任务继续运行", "'wait'", 4000],
    ],
  },
  tint: {
    mode: "page",
    steps: [
      ["无染色基准", SET_CFG({ base: BASE_ALWAYS, palette: "classic-green", blend: "screen", uiTint: { enabled: false, color: "#0d5c2e", strength: 0.25 } }), 1800],
      ["绿色染色 30%", SET_CFG({ uiTint: { enabled: true, color: "#0d5c2e", strength: 0.3 } }), 2200],
      ["紫染色 35%", SET_CFG({ uiTint: { enabled: true, color: "#5c2e8f", strength: 0.35 } }), 2200],
      ["关染色", SET_CFG({ uiTint: { enabled: false } }), 1500],
    ],
  },
  settings: {
    mode: "page",
    steps: [
      ["打开设置", `(function(){
        const btn=[...document.querySelectorAll('button')].find(e=>(e.textContent||'').trim().startsWith('设置'));
        if(btn) btn.click();
        return 'ok';
      })()`, 1500],
      ["进入矩阵雨页", `(function(){
        const els=[...document.querySelectorAll('button,[role="button"],li')];
        const entry=els.find(e=>((e.textContent||'').trim().includes('矩阵雨皮肤')));
        if(entry) entry.click();
        return entry?'ok':'no-entry';
      })()`, 2000],
      ["设置页全景", `'hold'`, 4500],
      ["拖动雨量滑杆(模拟)", `(function(){
        const sliders=[...document.querySelectorAll('input[type="range"]')];
        if(sliders[1]) {
          const s=sliders[1];
          s.value=60; s.dispatchEvent(new Event('input',{bubbles:true}));
        }
        return 'ok';
      })()`, 2500],
    ],
  },
};

ws.on("open", async () => {
  try {
    await send("Runtime.enable");
    await send("Page.enable");
    /* 无头默认 reduce-motion → 引擎会降级为静态一帧;覆盖为无偏好 */
    await send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
    });
    if (MODE === "page") {
      await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    }
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) {
      await sleep(2000);
      ready = (await ev(`document.title.includes('DeepSeek') && !!document.querySelector('[data-skin-chrome="matrix-rain"]')`)) === true;
    }
    if (!ready) { console.error("matrix-rain not mounted — is the skin active in 皮肤管理?"); process.exit(1); }
    console.log("skin mounted | mode:", MODE, "| scenario:", scenario);

    capturing = true;
    captureLoop();

    const sc = SCENARIOS[scenario];
    if (!sc) { console.error("unknown scenario:", scenario, "options:", Object.keys(SCENARIOS).join(",")); process.exit(1); }
    for (const [desc, js, wait] of sc.steps) {
      console.log("step:", desc);
      await ev(js);
      await sleep(wait);
    }
    await sleep(durationSec * 1000);

    capturing = false;
    await sleep(200);
    console.log("frames:", frameIdx, "→", OUT);
    ws.close(); process.exit(0);
  } catch (e) { console.error("failed:", e.message); process.exit(1); }
});
setTimeout(() => { console.error("timeout"); process.exit(1); }, 120000);
