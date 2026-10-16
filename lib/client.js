/*
 * matrix-rain skin client · src/client.template.js (v0.2)
 *
 * Compiled into lib/client.js by scripts/build-client.mjs (engine inlined at
 * the @INJECT_ENGINE@ marker). Presentation-only plugin with three faces:
 *   1. the rain overlay (canvas + backdrop, pointer-events:none);
 *   2. a skin-manager customization panel (master switch + schedule);
 *   3. a dedicated Settings sidebar page (设置 → 矩阵雨皮肤) with sliders,
 *      a color-wheel picker, rain timing (always / task-only) and TPS-adaptive
 *      speed. Registered through ctx.slots("settings.section") exactly like
 *      the proven dsh-web-search-anthropic-compat pattern.
 *
 * Hard safety rules (2026-10-12 incident):
 *  - apply() never throws; every subsystem (chrome / settings page / watchers)
 *    is independently try/catch'ed and self-cleaned via registerCleanup().
 *  - React is required lazily; if unavailable the settings page silently
 *    skips and the rain keeps working.
 *  - Task-state derivation reuses orca-link's proven host data-attributes
 *    ([data-phase], [data-state='running'], [data-composer-input]); TPS is
 *    parsed from the host-rendered "{tps} tok/s" chip text — both self-heal.
 */
window.__ModuleLoader__.load({
  id: "dsh-matrix-rain",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    /* ═══ 引擎(matrixrain.c 忠实移植,由构建脚本内联) ═══════════════ */
    /* 遮蔽 module/exports/require:引擎 UMD 探测不得劫持本工厂的导出 */
    (function (module, exports, require) {
      /*
 * matrix-rain engine · src/engine.js
 *
 * Faithful JavaScript port of matrixrain.c v8 (Win32 GDI, JamesBook-416 2026):
 *   冲击波终极重构: 物理位移(卷起) + 正弦涟漪波纹
 *
 * Every constant of the original is preserved; the fixed-step update cadence
 * (40 ms) is preserved via a requestAnimationFrame time accumulator, so the
 * physics feels identical to the screensaver.
 *
 * Dual-mode: usable as a plain <script> (window.MatrixRainEngine) and
 * syntax-checkable under Node (module.exports). It performs no DOM access at
 * definition time — only inside createEngine().
 */
(function (global) {
  "use strict";

  /* ─── 常量(全部对应 matrixrain.c) ─────────────────────────────────── */
  var FRAME_MS = 40;                       /* IDT_FRAME 40ms 定时器          */
  var CELL_W = 14, CELL_H = 18;            /* 网格单元                       */
  var FONT_H = 17;                         /* Consolas 字高                 */
  var MIN_TAIL = 3, MAX_TAIL = 18;         /* 尾长区间                       */
  var SHORT_TAIL = 6, MID_TAIL = 11;       /* 速度分档阈值                   */
  var GLITCH_PROB = 6;                     /* 1/6 概率换字符                 */
  var SPARK_PROB = 30;                     /* 1/30 概率火花亮字符            */
  var MAX_ROWS = 160;                      /* 行数上限                       */
  var MAX_SHOCKS = 30;                     /* 同时冲击波数                   */
  var WAVE_WIDTH = 150.0;                  /* 波宽                           */
  var GLOW_DECAY = 0.06;                   /* 余辉衰减                       */
  var LIGHT_RADIUS = 2;                    /* 鼠标光照半径(格)              */
  var SHOCK_PX_PER_MS_DEFAULT = 50 / 16.667; /* 默认时速:50px/帧@60fps */
  var SHOCK_MAX_R = 4000.0;                /* 波消亡半径                     */
  var PUSH_BASE = 28.0;                    /* 推力基数(随距离平方衰减)      */
  var DAMPING = 0.88;                      /* 偏移阻尼                       */
  var DAMP_EPS = 0.5;                      /* 偏移归零阈值                   */

  /* 字符池(与原版 POOL 一致);存池内下标,绘制时取预转字符串 */
  var POOL =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
    "0123456789!@#$%^&*()-+=[]{}|;:<>?,./~`_\\";
  var POOL_GLYPHS = POOL.split("");

  /* ─── 色板:classic-green 为原版 RGB 数学;ink* 供浅色 UI(multiply 压印) ── */
  /* 原版: body green = 45 + t²·210, spark (0,255,60), head (255,255,255) */
  /* head = 头部色; boost = 余辉提亮目标色(经典=白,墨系=黑)                */
  var PALETTES = {
    "classic-green": { dim: [0, 45, 0], bright: [0, 255, 60], head: [255, 255, 255], boost: [255, 255, 255] },
    "cyber-cyan": { dim: [0, 40, 45], bright: [0, 235, 255], head: [255, 255, 255], boost: [255, 255, 255] },
    "violet-rain": { dim: [35, 20, 55], bright: [200, 120, 255], head: [255, 255, 255], boost: [255, 255, 255] },
    "mono": { dim: [40, 40, 40], bright: [235, 235, 235], head: [255, 255, 255], boost: [255, 255, 255] },
    "amber": { dim: [45, 32, 0], bright: [255, 179, 0], head: [255, 255, 255], boost: [255, 255, 255] },
    "blood": { dim: [45, 0, 0], bright: [255, 42, 42], head: [255, 255, 255], boost: [255, 255, 255] },
    "ink-green": { dim: [125, 150, 135], bright: [0, 120, 50], head: [0, 0, 0], boost: [0, 0, 0] },
    "ink-mono": { dim: [150, 150, 150], bright: [30, 30, 30], head: [0, 0, 0], boost: [0, 0, 0] },
    /* 彩虹:颜色按 (全局色相时辰 + 列×11 + 行×3) 流转,绘制期查 LUT */
    "rainbow": { dim: [90, 90, 90], bright: [255, 255, 255], head: [255, 255, 255], boost: [255, 255, 255] },
  };
  var DEFAULT_PALETTE = "classic-green";

  function hslToRgbLocal(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = ((h % 360) + 360) % 360 / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r = 0, g = 0, b = 0;
    if (hp < 1) { r = c; g = x; } else if (hp < 2) { r = x; g = c; }
    else if (hp < 3) { g = c; b = x; } else if (hp < 4) { g = x; b = c; }
    else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    var m = l - c / 2;
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }
  /* 彩虹 LUT:36 档 hue × (dim L=0.34 / bright L=0.62) */
  var RAINBOW_LUT = (function () {
    var dim = [], bright = [];
    for (var i = 0; i < 36; i++) {
      dim.push(hslToRgbLocal(i * 10, 0.95, 0.34));
      bright.push(hslToRgbLocal(i * 10, 1.0, 0.62));
    }
    return { dim: dim, bright: bright };
  })();

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* 由用户点选的单色推导整套色板(增亮模式 head 偏白,压印模式 head 偏黑) */
  function paletteFromColor(rgb, ink) {
    var r = rgb[0], g = rgb[1], b = rgb[2];
    var mix = function (a, t, k) { return Math.round(a + (t - a) * k); };
    if (!ink) {
      return {
        dim: [mix(r, 0, 0.84), mix(g, 0, 0.84), mix(b, 0, 0.84)],
        bright: [r, g, b],
        head: [mix(r, 255, 0.75), mix(g, 255, 0.75), mix(b, 255, 0.75)],
        boost: [255, 255, 255],
      };
    }
    return {
      dim: [mix(r, 255, 0.55), mix(g, 255, 0.55), mix(b, 255, 0.55)],
      bright: [mix(r, 0, 0.55), mix(g, 0, 0.55), mix(b, 0, 0.55)],
      head: [0, 0, 0],
      boost: [0, 0, 0],
    };
  }

  function createEngine(opts) {
    opts = opts || {};
    var canvas = opts.canvas;
    if (!canvas || !canvas.getContext) {
      throw new Error("matrix-rain: canvas element required");
    }
    var doc = opts.ownerDocument || (typeof document !== "undefined" ? document : null);
    var win = opts.ownerWindow || (doc ? doc.defaultView : global);

    /* ── 可调参数(默认值 = 原版观感) ── */
    var mode = opts.mode === "overlay" ? "overlay" : "background";
    var paletteName = PALETTES[opts.palette] ? opts.palette : DEFAULT_PALETTE;
    var customColor = [0, 255, 60];               /* 用户点选色(palette=custom 时生效) */
    var customInk = false;                        /* 压印模式推导暗色系 */
    var frameMs = clamp(opts.frameMs == null ? FRAME_MS : opts.frameMs, 8, 80);
    var density = clamp(opts.density == null ? 1 : opts.density, 0.15, 1);
    var cellScale = clamp(opts.cellScale == null ? 1 : opts.cellScale, 0.7, 1.6);
    var interaction = opts.interaction !== false; /* 冲击波 + 光晕开关 */
    var staticFrame = !!opts.staticFrame;          /* 无动画静态一帧(reduced-motion) */
    var turbo = 0;                                 /* 超速特效强度 0..1(随机高亮) */
    var rainbowHue = 0;                            /* 彩虹全局色相时辰 */
    var shockPxPerMs = SHOCK_PX_PER_MS_DEFAULT;    /* 冲击波时速(可调,与雨速解耦) */

    var ctx = canvas.getContext("2d", { alpha: mode === "overlay" });

    /* ── 网格状态 ── */
    var dpr = 1, W = 0, H = 0, NC = 0, NR = 0;
    var cellW, cellH, fontPx, fontSpec;
    var cols = [];   /* {head,tail,spd,tick,sleep,ch:Uint8Array,glow,ox,oy:Float32Array} */
    var shocks = []; /* {x,y,r} */

    var rand = Math.random;

    function rcharIndex() {
      return (rand() * POOL.length) | 0;
    }

    /* ─── 重置列(对应 col_reset) ───────────────────────────────────── */
    function colReset(i) {
      var c = cols[i];
      c.tail = MIN_TAIL + ((rand() * (MAX_TAIL - MIN_TAIL + 1)) | 0);
      if (c.tail <= SHORT_TAIL) c.spd = 1;
      else if (c.tail <= MID_TAIL) c.spd = 2;
      else c.spd = 3;
      c.head = -(1 + ((rand() * 3) | 0));
      c.tick = (rand() * c.spd) | 0;
      c.sleep = rand() <= density ? 0 : 1 + ((rand() * 50) | 0); /* 密度<1 时让部分列休眠 */
      for (var r = 0; r < NR; r++) {
        c.ch[r] = rcharIndex();
        c.glow[r] = 0.0;
        c.ox[r] = 0.0;
        c.oy[r] = 0.0;
      }
    }

    /* ─── 初始化(对应 rain_init) ───────────────────────────────────── */
    function rainInit() {
      for (var i = 0; i < NC; i++) {
        colReset(i);
        if ((rand() * 2 | 0) === 0) cols[i].head = (rand() * NR) | 0;
        else cols[i].head -= (rand() * NR) | 0;
      }
    }

    /* ─── 尺寸与网格重建 ────────────────────────────────────────────── */
    function resize() {
      dpr = clamp(win.devicePixelRatio || 1, 1, 2.5);
      W = Math.max(1, Math.round(canvas.clientWidth || win.innerWidth || 320));
      H = Math.max(1, Math.round(canvas.clientHeight || win.innerHeight || 240));
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cellW = Math.max(6, Math.round(CELL_W * cellScale));
      cellH = Math.max(8, Math.round(CELL_H * cellScale));
      fontPx = Math.max(8, Math.round(FONT_H * cellScale));
      fontSpec = 'bold ' + fontPx + 'px Consolas, "Courier New", Menlo, monospace';
      NC = (W / cellW | 0) + 1;
      NR = Math.min((H / cellH | 0) + 2, MAX_ROWS);
      cols = new Array(NC);
      for (var i = 0; i < NC; i++) {
        cols[i] = {
          head: 0, tail: 8, spd: 2, tick: 0, sleep: 0,
          ch: new Uint8Array(NR),
          glow: new Float32Array(NR),
          ox: new Float32Array(NR),
          oy: new Float32Array(NR),
        };
      }
      rainInit();
    }

    /* ─── 逻辑步进(对应 rain_update):只管雨列本身 ─────────────────── */
    function step() {
      var i, r, c, top;

      /* 1. 列推进 + glitch */
      for (i = 0; i < NC; i++) {
        c = cols[i];
        if (c.sleep > 0) { c.sleep--; continue; }
        if (++c.tick < c.spd) continue;
        c.tick = 0;
        c.head++;
        top = c.head - c.tail;
        var lo = top > 0 ? top : 0;
        var hi = c.head < NR ? c.head : NR - 1;
        for (r = lo; r <= hi; r++) {
          if ((rand() * GLITCH_PROB | 0) === 0) c.ch[r] = rcharIndex();
        }
        if (top > NR) colReset(i);
      }
    }

    /* ─── 每渲染帧的实时处理(与雨速完全解耦,统一以真实时间驱动) ──────
       冲击波作用+推进 / 余辉衰减 / 阻尼回弹 / 彩虹时辰 / turbo 闪光。
       基准节拍 = 原版 40ms:系数 k = dtMs/40,默认速度下观感与原版一致,
       任意雨速/刷新率下波速、涟漪寿命、回弹节奏恒定。 */
    var BASE_TICK_MS = 40;
    function processFrame(dtMs) {
      var i, r, c;
      var k = dtMs / BASE_TICK_MS;

      /* 0. 彩虹时辰 + 超速随机高亮(按时间比例发放) */
      if (paletteName === "rainbow") rainbowHue = (rainbowHue + 3 * k) % 360;
      if (turbo > 0) {
        var expected = (4 + turbo * 20) * k;
        var flashes = expected | 0;
        if (rand() < expected - flashes) flashes += 1;
        for (var f = 0; f < flashes; f++) {
          var fi = (rand() * NC) | 0, fr = (rand() * NR) | 0;
          if (fi < NC && fr < NR) {
            var want = 0.5 + turbo * 0.45;
            if (cols[fi].glow[fr] < want) cols[fi].glow[fr] = want;
          }
        }
      }

      /* 1. 冲击波作用:正弦涟漪(max 写入,天然刷新率无关) + 推力冲量归一
            推力按「波前每帧推进距离 / 原版每步 15px」缩放:波越快,单次作用
            越强、作用次数越少,总冲量(位移幅度)与波速无关,默认值等价原版。 */
      if (shocks.length > 0) {
        var pushScale = (shockPxPerMs * dtMs) / 15; /* 原版基准:15px/步 */
        for (i = 0; i < NC; i++) {
          c = cols[i];
          var px = i * cellW;
          for (r = 0; r < NR; r++) {
            var dist = c.head - r;
            if (dist < 0 || dist >= c.tail) continue;
            var cx = px + cellW / 2;
            var cy = r * cellH + cellH / 2;
            for (var s = 0; s < shocks.length; s++) {
              var sh = shocks[s];
              var sdx = cx - sh.x;
              var sdy = cy - sh.y;
              var maxR = sh.r + WAVE_WIDTH;
              if (sdx > maxR || sdx < -maxR || sdy > maxR || sdy < -maxR) continue;
              var d2 = Math.sqrt(sdx * sdx + sdy * sdy);
              var diff = d2 - sh.r;
              var half = WAVE_WIDTH / 2;
              if (diff > -half && diff < half) {
                var phase = ((diff + half) / WAVE_WIDTH) * 6.2831853;
                var glowVal = Math.sin(phase) * 0.9;
                if (glowVal > c.glow[r]) c.glow[r] = glowVal;
                if (diff > 0 && d2 > 1.0) {
                  var pf = 1.0 - diff / half;
                  var push = pf * pf * PUSH_BASE * pushScale;
                  c.ox[r] += (sdx / d2) * push;
                  c.oy[r] += (sdy / d2) * push;
                }
              }
            }
          }
        }
        /* 波前推进(真实时间基,时速可调)与消亡 */
        for (i = shocks.length - 1; i >= 0; i--) {
          shocks[i].r += shockPxPerMs * dtMs;
          if (shocks[i].r > SHOCK_MAX_R) shocks.splice(i, 1);
        }
      }

      /* 2. 余辉衰减 + 阻尼回弹(按时间比例,与雨速无关) */
      var glowDecay = GLOW_DECAY * k;
      var dampFactor = Math.pow(DAMPING, k);
      for (i = 0; i < NC; i++) {
        c = cols[i];
        for (r = 0; r < NR; r++) {
          if (c.glow[r] > 0.0) {
            c.glow[r] -= glowDecay;
            if (c.glow[r] < 0.0) c.glow[r] = 0.0;
          }
          c.ox[r] *= dampFactor;
          c.oy[r] *= dampFactor;
          if (c.ox[r] < DAMP_EPS && c.ox[r] > -DAMP_EPS) c.ox[r] = 0;
          if (c.oy[r] < DAMP_EPS && c.oy[r] > -DAMP_EPS) c.oy[r] = 0;
        }
      }
    }

    /* 当前生效色板(custom 时按点选色现推) */
    var palCache = null, palKey = "";
    function resolvePalette() {
      var key = paletteName + "|" + (paletteName === "custom" ? customColor.join(",") + "|" + customInk : "");
      if (palKey !== key) {
        palCache = paletteName === "custom"
          ? paletteFromColor(customColor, customInk)
          : PALETTES[paletteName];
        palKey = key;
      }
      return palCache;
    }

    /* ─── 绘制(对应 rain_draw,按色桶批量) ────────────────────────── */
    var bucketMap = new Map(); /* "r,g,b(量化)" -> [glyphIdx, x, y, ...] */
    function render() {
      if (mode === "background") {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, W, H);
      } else {
        ctx.clearRect(0, 0, W, H);
      }
      ctx.font = fontSpec;
      ctx.textBaseline = "top";
      bucketMap.clear();

      var pal = resolvePalette();
      var dimR = pal.dim[0], dimG = pal.dim[1], dimB = pal.dim[2];
      var brR = pal.bright[0], brG = pal.bright[1], brB = pal.bright[2];
      var hdR = pal.head[0], hdG = pal.head[1], hdB = pal.head[2];
      var boR = pal.boost[0], boG = pal.boost[1], boB = pal.boost[2];
      var isRainbow = paletteName === "rainbow";
      var sparkProb = SPARK_PROB / (1 + turbo * 2); /* 超速时火花更密 */

      for (var i = 0; i < NC; i++) {
        var c = cols[i];
        var px = i * cellW;
        for (var r = 0; r < NR; r++) {
          var dist = c.head - r;
          if (dist < 0 || dist >= c.tail) continue;

          var red, green, blue;
          if (dist === 0) {
            red = hdR; green = hdG; blue = hdB;                    /* 头部色 */
          } else if (isRainbow) {
            /* 彩虹:每格 hue = 时辰 + 列×11 + 行×3,LUT 36 档 */
            var hIdx = (((rainbowHue + i * 11 + r * 3) % 360) / 10) | 0;
            var t = 1.0 - dist / c.tail;
            var t2 = t * t;
            var rd = RAINBOW_LUT.dim[hIdx], rb = RAINBOW_LUT.bright[hIdx];
            red = (rd[0] + (rb[0] - rd[0]) * t2) | 0;
            green = (rd[1] + (rb[1] - rd[1]) * t2) | 0;
            blue = (rd[2] + (rb[2] - rd[2]) * t2) | 0;
            if ((rand() * sparkProb | 0) === 0) { red = rb[0]; green = rb[1]; blue = rb[2]; }
          } else {
            var t = 1.0 - dist / c.tail;
            var t2 = t * t;
            red = (dimR + (brR - dimR) * t2) | 0;           /* 原版: 45+t²·210 */
            green = (dimG + (brG - dimG) * t2) | 0;
            blue = (dimB + (brB - dimB) * t2) | 0;
            if ((rand() * sparkProb | 0) === 0) {           /* 火花 */
              red = brR; green = brG; blue = brB;
            }
          }

          /* 余辉向提亮目标色靠拢(经典=白,墨系=黑) */
          var boost = c.glow[r];
          if (boost > 0.0) {
            red = (red + (boR - red) * boost) | 0;
            green = (green + (boG - green) * boost) | 0;
            blue = (blue + (boB - blue) * boost) | 0;
          }

          var key = ((red >> 3) << 3) + "," + ((green >> 3) << 3) + "," + ((blue >> 3) << 3);
          var bucket = bucketMap.get(key);
          if (!bucket) { bucket = []; bucketMap.set(key, bucket); }
          bucket.push(c.ch[r], px + (c.ox[r] | 0), r * cellH + (c.oy[r] | 0));
        }
      }

      bucketMap.forEach(function (cells, key) {
        ctx.fillStyle = "rgb(" + key + ")";
        for (var k = 0; k < cells.length; k += 3) {
          ctx.fillText(POOL_GLYPHS[cells[k]], cells[k + 1], cells[k + 2]);
        }
      });
    }

    /* ─── 交互(对应 WM_MOUSEMOVE / WM_LBUTTONDOWN) ─────────────────── */
    /* 鼠标光照:直接写 glow(事件驱动,同原版消息处理) */
    function lightAt(x, y) {
      if (!interaction) return;
      var ci = (x / cellW) | 0;
      var ri = (y / cellH) | 0;
      for (var dc = -LIGHT_RADIUS; dc <= LIGHT_RADIUS; dc++) {
        for (var dr = -LIGHT_RADIUS; dr <= LIGHT_RADIUS; dr++) {
          var i = ci + dc, r = ri + dr;
          if (i >= 0 && i < NC && r >= 0 && r < NR) {
            var d = Math.sqrt(dc * dc + dr * dr);
            var intensity = 1.0 - d / (LIGHT_RADIUS + 1.0);
            if (intensity < 0) intensity = 0;
            if (intensity > cols[i].glow[r]) cols[i].glow[r] = intensity;
          }
        }
      }
    }

    /* 左键冲击波 */
    function shock(x, y) {
      if (!interaction) return;
      if (shocks.length >= MAX_SHOCKS) shocks.shift();
      shocks.push({ x: x, y: y, r: 0 });
    }

    /* ─── 主循环:rAF + 固定步累加器(雨列) + 实时帧处理(波/衰减) ──── */
    var raf = 0, last = 0, acc = 0, running = false;
    function frame(ts) {
      if (!running) return;
      if (!last) last = ts;
      var dt = ts - last;
      last = ts;
      if (dt > 250) dt = frameMs; /* 长挂起后防追赶雪崩 */
      acc += dt;
      var guard = 0;
      while (acc >= frameMs && guard < 5) {
        step();
        acc -= frameMs;
        guard++;
      }
      if (guard >= 5) acc = 0;
      processFrame(Math.min(dt, 120)); /* 冲击波/余辉/阻尼:真实时间基,与雨速解耦 */
      render();
      raf = win.requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      if (staticFrame) { /* reduced-motion:只渲染静态一帧,不进循环 */
        render();
        return;
      }
      running = true;
      last = 0; acc = 0;
      raf = win.requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      if (raf && win.cancelAnimationFrame) win.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* 页面隐藏自动暂停(皮肤常驻的必要节能) */
    var onVisibility = function () {
      if (doc.hidden) stop();
      else if (autoRun) start();
    };
    var autoRun = false;

    /* ─── 运行期改参(设置面板热更新) ──────────────────────────────── */
    function setOptions(next) {
      next = next || {};
      var rebuild = false;
      if (next.palette && (PALETTES[next.palette] || next.palette === "custom") && next.palette !== paletteName) {
        paletteName = next.palette;
      }
      if (next.customColor && Array.isArray(next.customColor) && next.customColor.length === 3) {
        customColor = [
          clamp(next.customColor[0] | 0, 0, 255),
          clamp(next.customColor[1] | 0, 0, 255),
          clamp(next.customColor[2] | 0, 0, 255),
        ];
      }
      if (next.customInk != null) customInk = !!next.customInk;
      if (next.frameMs != null) frameMs = clamp(next.frameMs, 8, 80);
      if (next.turbo != null) turbo = clamp(+next.turbo, 0, 1);
      if (next.shockPxPerFrame != null) {
        shockPxPerMs = clamp(+next.shockPxPerFrame, 2, 200) / 16.667; /* 2..200 px/帧@60fps */
      }
      if (next.density != null && next.density !== density) density = clamp(next.density, 0.15, 1);
      if (next.cellScale != null && next.cellScale !== cellScale) {
        cellScale = clamp(next.cellScale, 0.7, 1.6);
        rebuild = true;
      }
      if (next.interaction != null) interaction = !!next.interaction;
      if (next.mode != null && next.mode !== mode) {
        mode = next.mode === "overlay" ? "overlay" : "background";
        rebuild = true; /* alpha 上下文不可切换,重建由宿主负责 */
      }
      if (rebuild) resize();
    }

    /* ─── 生命周期 ──────────────────────────────────────────────────── */
    function init(autoStart) {
      resize();
      doc.addEventListener("visibilitychange", onVisibility);
      autoRun = !!autoStart;
      if (autoStart) start();
    }
    function destroy() {
      stop();
      doc.removeEventListener("visibilitychange", onVisibility);
      bucketMap.clear();
      cols = [];
      shocks = [];
    }

    return {
      start: start,
      stop: stop,
      init: init,
      destroy: destroy,
      resize: resize,
      shock: shock,
      lightAt: lightAt,
      setOptions: setOptions,
      getStats: function () {
        return { W: W, H: H, NC: NC, NR: NR, shocks: shocks.length, running: running, frameMs: frameMs, turbo: turbo };
      },
    };
  }

  var api = { createEngine: createEngine, PALETTES: PALETTES, FRAME_MS: FRAME_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.MatrixRainEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
    })(undefined, undefined, undefined);
    var MR = window.MatrixRainEngine;
    delete window.MatrixRainEngine;

    /* ═══ 皮肤定制协议 v2 shim(与 deep-whale-manager 逐语义一致) ════ */
    var SKIN_CUSTOMIZATION_PROTOCOL = 2;
    var SKIN_CUSTOMIZATION_EVENTS = {
      1: {
        register: "dsh:skin-customization-register-v1",
        unregister: "dsh:skin-customization-unregister-v1",
        ready: "dsh:skin-customization-ready-v1",
      },
      2: {
        register: "dsh:skin-customization-register-v2",
        unregister: "dsh:skin-customization-unregister-v2",
        ready: "dsh:skin-customization-ready-v2",
      },
    };
    function exposeSkinCustomization(definition, target) {
      target = target || window;
      var token = {};
      var events = SKIN_CUSTOMIZATION_EVENTS[definition.protocol];
      var register = function () {
        target.dispatchEvent(new CustomEvent(events.register, {
          detail: { token: token, definition: definition },
        }));
      };
      target.addEventListener(events.ready, register);
      register();
      return function () {
        target.removeEventListener(events.ready, register);
        target.dispatchEvent(new CustomEvent(events.unregister, {
          detail: { token: token, definition: definition },
        }));
        definition.apply(null);
      };
    }

    /* ═══ 页面配置存储(localStorage + 跨组件同步事件) ══════════════ */
    var CONFIG_KEY = "dsh-skin-matrix-rain:config:v1";
    var CONFIG_EVENT = "dsh-matrix-rain:config";
    var PREVIEW_EVENT = "dsh-matrix-rain:preview"; /* 设置页调参时强制现身几秒 */
    var CONFIG_DEFAULTS = {
      v: 4,                       /* 配置版本:升级时做一次性迁移 */
      master: true,              /* 页面侧总开关 */
      timing: "task",            /* always | task —— 2026-10-15 起默认仅任务时(James 定制默认) */
      tpsAdaptive: true,         /* 仅任务模式:速度按 TPS 自适应 */
      rainArea: "transcript",    /* full | transcript —— 默认对话区 */
      palette: "rainbow",        /* 默认彩虹 */
      glyphColor: "#ff2a2a",     /* 自定义字符色备选 */
      blend: "auto",             /* auto | screen | multiply */
      speedMult: 2.1,            /* 速度倍率 0.5..4(仅非跟随模式生效) */
      shockSpeed: 5,             /* 冲击波时速 px/帧@60fps,5..120,与雨速解耦 */
      density: 0.15,             /* 最稀 */
      glyphScale: 0.7,           /* 最小字 */
      opacity: 0.3,              /* 雨幕浓度 30% */
      backdrop: { enabled: false, color: "#021208", alpha: 0.35 },
      uiTint: { enabled: false, color: "#3d3d3d", strength: 0.25 },
      interactions: ["shock", "glow"],
    };
    function readConfig() {
      var out = JSON.parse(JSON.stringify(CONFIG_DEFAULTS));
      try {
        var raw = localStorage.getItem(CONFIG_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          /* v3 迁移:背景衬色默认关闭 */
          if (saved.v !== CONFIG_DEFAULTS.v) {
            saved.backdrop = JSON.parse(JSON.stringify(CONFIG_DEFAULTS.backdrop));
            /* v4 迁移:旧 frameMs(16..80)换算成速度倍率 */
            if (typeof saved.frameMs === "number" && saved.frameMs > 0) {
              saved.speedMult = Math.min(4, Math.max(0.5, 40 / saved.frameMs));
            }
            delete saved.frameMs;
            saved.uiTint = JSON.parse(JSON.stringify(CONFIG_DEFAULTS.uiTint));
            saved.v = CONFIG_DEFAULTS.v;
            try { localStorage.setItem(CONFIG_KEY, JSON.stringify(saved)); } catch (e2) { /* 回写失败仅影响下次迁移 */ }
          }
          Object.keys(saved).forEach(function (k) {
            if (k === "backdrop" && saved[k] && typeof saved[k] === "object") {
              out.backdrop = Object.assign({}, CONFIG_DEFAULTS.backdrop, saved.backdrop);
            } else if (k === "uiTint" && saved[k] && typeof saved[k] === "object") {
              out.uiTint = Object.assign({}, CONFIG_DEFAULTS.uiTint, saved.uiTint);
            } else if (saved[k] !== undefined && saved[k] !== null) {
              out[k] = saved[k];
            }
          });
        }
      } catch (e) { /* 损坏则回到默认 */ }
      return out;
    }
    function writeConfig(partial) {
      var next = Object.assign(readConfig(), partial);
      try {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
      } catch (e) { warn(e); }
      try { window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: next })); } catch (e) { warn(e); }
      return next;
    }

    /* ═══ 颜色工具 ══════════════════════════════════════════════════ */
    function hexToRgb(hex) {
      var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
      if (!m) return [0, 255, 60];
      var n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbToHex(rgb) {
      return "#" + rgb.map(function (v) {
        return clampI(v, 0, 255).toString(16).padStart(2, "0");
      }).join("");
    }
    function clampI(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
    /* HSL → RGB(h:0-360, s:0-1, l:0-1) */
    function hslToRgb(h, s, l) {
      var c = (1 - Math.abs(2 * l - 1)) * s;
      var hp = (h % 360) / 60;
      var x = c * (1 - Math.abs((hp % 2) - 1));
      var r = 0, g = 0, b = 0;
      if (hp < 1) { r = c; g = x; }
      else if (hp < 2) { r = x; g = c; }
      else if (hp < 3) { g = c; b = x; }
      else if (hp < 4) { g = x; b = c; }
      else if (hp < 5) { r = x; b = c; }
      else { r = c; b = x; }
      var m = l - c / 2;
      return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
    }
    function rgbToHsl(rgb) {
      var r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255;
      var max = Math.max(r, g, b), min = Math.min(r, g, b);
      var h = 0, s = 0, l = (max + min) / 2;
      if (max !== min) {
        var d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
        else if (max === g) h = ((b - r) / d + 2) * 60;
        else h = ((r - g) / d + 4) * 60;
      }
      return [h, s, l];
    }

    /* ═══ 任务状态推导(orca-link 验证过的宿主 data-* 配方) ══════════ */
    /* 状态: standby | syncing | working | approval | review | input | complete | fault | ready */
    var TASK_ACTIVE_STATES = { working: 1, syncing: 1, approval: 1, review: 1, input: 1 };
    function conversationRoot(body) {
      var candidates = body.querySelectorAll("[data-phase]");
      for (var i = 0; i < candidates.length; i++) {
        var scroll = candidates[i].querySelector("[data-conversation-scroll]");
        if (scroll && scroll.closest("[data-phase]") === candidates[i]) return candidates[i];
      }
      return null;
    }
    function resolveTaskStatus(body) {
      var root = conversationRoot(body);
      if (!root) return "standby";
      var phase = root.dataset ? root.dataset.phase : "";
      if (phase === "hero") return "standby";
      if (phase === "settling") return "syncing";
      if (phase !== "active") return "ready";
      if (root.querySelector("[data-approval-key]")) return "approval";
      if (root.querySelector("[data-plan-review-key]")) return "review";
      if (root.querySelector("[data-question-key]")) return "input";
      var input = root.querySelector("[data-composer-input][data-phase]");
      var ip = input && input.dataset ? input.dataset.phase : "";
      if (ip === "submitting" || ip === "adjudicating") return "syncing";
      /* working 判定只用"新鲜"信号(2026-10-15 修):
         ① 停止生成按钮在场 = 本回合正在产出;
         ② 会话流末行(含 turn-tail 前最后一行)带 data-state=running。
         不再全局扫 [data-state=running] —— 被崩溃/中断打断的旧工具行
         会永久残留 running 标记,导致无任务的老会话页误判一直下雨。 */
      var stopBtn = root.querySelector('button[aria-label*="停止"], button[title*="停止"]');
      if (stopBtn) return "working";
      var flow = root.querySelector("[data-chat-flow]");
      if (!flow) return "ready";
      var kids = flow.children;
      for (var k = kids.length - 1; k >= 0; k--) {
        var kind = kids[k].getAttribute && kids[k].getAttribute("data-chat-flow-kind");
        if (!kind) continue;
        if (kids[k].querySelector("[data-state='error'],[data-state='interrupted']")) return "fault";
        if (kind === "turn-tail") return "complete";
        /* 末个内容行:running 才算 working,其余算就绪 */
        return kids[k].querySelector("[data-state='running']") ? "working" : "ready";
      }
      return "ready";
    }
    /* 从宿主渲染的 "{tps} tok/s" 文本提取最近一次 TPS(自愈:找不到就维持旧值) */
    function readTps(body) {
      try {
        var root = conversationRoot(body) || body;
        var text = root.textContent || "";
        var matches = text.match(/(\d+(?:\.\d+)?)\s*tok\s*\/\s*s/gi);
        if (!matches || matches.length === 0) return null;
        var last = parseFloat(matches[matches.length - 1]);
        return isFinite(last) ? last : null;
      } catch (e) { return null; }
    }
    /* TPS → 帧间隔: 40tps=原版40ms;80→27;150→17;250→11;500→8(封顶120fps) */
    function tpsToFrameMs(tps) {
      if (tps == null || !isFinite(tps)) return 40;
      return clampI(Math.round(3200 / (tps + 40)), 8, 80);
    }
    /* 等效 TPS(由最终帧间隔反推,用于手动模式的超速判定) */
    function frameMsToEqTps(frameMs) {
      return 3200 / frameMs - 40;
    }

    /* ═══ 皮肤本体 ══════════════════════════════════════════════════ */
    var managerState = { values: { master: true }, visibility: { schedule: true } };
    var config = readConfig();
    var engine = null;
    var canvas = null, backdrop = null;
    var cleanups = [];
    var installed = false;
    var taskStatus = "standby";
    var lastTps = null;
    var previewUntil = 0;        /* 设置页调参预览:该时刻前无视所有门控强制现身 */
    var previewTimer = 0;
    var managerOnline = false;   /* 皮肤管理器(第三方)是否在线 */

    function registerCleanup(fn) { cleanups.push(fn); }
    function runCleanups() {
      for (var i = cleanups.length - 1; i >= 0; i--) {
        try { cleanups[i](); } catch (e) { /* 清理永不抛 */ }
      }
      cleanups = [];
    }
    function warn(e) { try { console.warn("[matrix-rain]", e); } catch (e2) { /* noop */ } }

    function inPreview() { return Date.now() < previewUntil; }

    function startPreview(ms) {
      previewUntil = Date.now() + (ms || 4000);
      clearTimeout(previewTimer);
      previewTimer = setTimeout(function () {
        previewUntil = 0;
        applyPresentation();
      }, (ms || 4000) + 30);
      applyPresentation();
    }

    function hostIsLight() {
      try {
        for (var i = 0; i < 2; i++) {
          var el = i === 0 ? document.documentElement : document.body;
          var bg = getComputedStyle(el).backgroundColor;
          var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(bg || "");
          if (m) {
            var a = m[4] == null ? 1 : parseFloat(m[4]);
            if (a > 0.6) {
              var lum = (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) / 255;
              return lum > 0.6;
            }
          }
        }
      } catch (e) { /* 保守按深色 */ }
      return false;
    }

    var workspaceRunning = false; /* 当前工作区内任意会话在跑(含后台会话) */
    /* 工作区级运行检测(仅限当前工作区,2026-10-15 二次实测定稿):
       - 侧栏是平铺树:工作区行 treeitem[workspace:*] 之后、下一个工作区行之前的
         session:* 行属于该工作区;切走后旧工作区的会话行仍留在 DOM,不能全扫;
       - 当前工作区 = 含 aria-selected 会话行的分组;选中行被虚拟化时按
         document.title 匹配会话标题找分组;仍找不到 → 判 false(宁可不淋不错淋);
       - 运行标记 = 会话行内 data-state="ongoing"(后台任务也标)。 */
    function workspaceHasRunning(body) {
      try {
        var items = body.querySelectorAll('[role="treeitem"]');
        var groups = [];
        var current = null;
        for (var i = 0; i < items.length; i++) {
          var el = items[i];
          var key = el.getAttribute("data-row-key") || "";
          if (key.indexOf("workspace:") === 0) {
            current = { el: el, sessions: [] };
            groups.push(current);
          } else if (key.indexOf("session:") === 0 && current) {
            current.sessions.push(el);
          }
        }
        if (groups.length === 0) return false;
        var active = null;
        /* 锚1:选中会话行 */
        for (var g = 0; g < groups.length && !active; g++) {
          for (var s = 0; s < groups[g].sessions.length; s++) {
            if (groups[g].sessions[s].getAttribute("aria-selected") === "true") { active = groups[g]; break; }
          }
        }
        /* 锚2:document.title 前缀 = 当前会话标题(选中行被虚拟化时的兜底) */
        if (!active) {
          var title = (document.title || "").split("—")[0].trim();
          if (title) {
            for (var g2 = 0; g2 < groups.length && !active; g2++) {
              for (var s2 = 0; s2 < groups[g2].sessions.length; s2++) {
                if ((groups[g2].sessions[s2].textContent || "").indexOf(title) >= 0) { active = groups[g2]; break; }
              }
            }
          }
        }
        /* 找不到当前工作区 → 保守不淋(会话级检测仍覆盖当前会话) */
        if (!active) return false;
        for (var s3 = 0; s3 < active.sessions.length; s3++) {
          if (active.sessions[s3].querySelector('[data-state="ongoing"]')) return true;
        }
      } catch (e) { /* noop */ }
      return false;
    }

    function taskAllowsRain() {
      if (config.timing !== "task") return true;
      return !!TASK_ACTIVE_STATES[taskStatus] || workspaceRunning;
    }

    function updateClipRegion() {
      if (!canvas) return;
      try {
        var clip = "none";
        if (config.rainArea === "transcript") {
          var el = document.querySelector("[data-conversation-scroll]");
          if (el) {
            var r = el.getBoundingClientRect();
            clip = "inset(" + Math.max(0, r.top) + "px " +
              Math.max(0, window.innerWidth - r.right) + "px " +
              Math.max(0, window.innerHeight - r.bottom) + "px " +
              Math.max(0, r.left) + "px)";
          }
        }
        canvas.style.clipPath = clip;
        if (backdrop) backdrop.style.clipPath = clip; /* 衬色只铺雨幕区域,不再罩暗全窗 */
      } catch (e) { warn(e); }
    }

    /* 迟滞:开雨瞬时,断雨延迟 1.2s 宽限 —— 回合分段间隙的瞬时假阴性
       (工具行刚完成、下一运行行未挂上)不再让雨闪断(2026-10-15 修) */
    var lastGateTrueTs = 0;
    var RAIN_OFF_GRACE_MS = 1200;
    function effectiveVisible(gatesTrue) {
      var now = Date.now();
      if (gatesTrue || inPreview()) {
        lastGateTrueTs = now;
        return true;
      }
      return now - lastGateTrueTs < RAIN_OFF_GRACE_MS;
    }

    function applyPresentation() {
      if (!engine || !canvas) return;
      var visible = effectiveVisible(
        !!managerState.values.master
        && managerState.visibility.schedule !== false
        && !!config.master
        && taskAllowsRain()
      );

      var blendMode = config.blend === "auto" ? (hostIsLight() ? "multiply" : "screen") : config.blend;
      var isMultiply = blendMode === "multiply";

      /* 色板:预设 or 自定义点选色(压印模式自动墨色推导;彩虹两种模式都原生支持) */
      var enginePalette = config.palette;
      var engineInk = false;
      if (enginePalette === "custom") {
        engineInk = isMultiply;
      } else if (enginePalette !== "rainbow") {
        if (isMultiply && enginePalette.indexOf("ink") !== 0) {
          enginePalette = "ink-green";
        } else if (!isMultiply && enginePalette.indexOf("ink") === 0) {
          enginePalette = enginePalette === "ink-mono" ? "mono" : "classic-green";
        }
      }

      /* 速度:跟随 TPS 时纯按 TPS 走,倍率不参与(2026-10-15 按需求改);
         非跟随时 = 原速×倍率。>250 等效tps 触发随机高亮 */
      var adaptive = config.timing === "task" && config.tpsAdaptive && lastTps != null;
      var frameMs;
      if (adaptive) {
        frameMs = tpsToFrameMs(lastTps);
      } else {
        var mult = Math.min(4, Math.max(0.5, +config.speedMult || 1));
        frameMs = clampI(Math.round(40 / mult), 8, 80);
      }
      var turboLevel = 0;
      if (adaptive && lastTps > 250) turboLevel = Math.min(1, (lastTps - 250) / 250);
      else {
        var eqTps = frameMsToEqTps(frameMs);
        if (eqTps > 250) turboLevel = Math.min(1, (eqTps - 250) / 250);
      }

      var inter = config.interactions || [];
      engine.setOptions({
        palette: enginePalette,
        customColor: hexToRgb(config.glyphColor),
        customInk: engineInk,
        frameMs: frameMs,
        turbo: turboLevel,
        shockPxPerFrame: clampI(+config.shockSpeed || 50, 5, 120),
        density: config.density,
        cellScale: config.glyphScale,
        interaction: inter.indexOf("shock") >= 0 || inter.indexOf("glow") >= 0,
      });

      canvas.style.mixBlendMode = blendMode;
      canvas.style.opacity = String(config.opacity);
      if (backdrop) {
        var on = !!config.backdrop.enabled;
        backdrop.style.display = on ? "block" : "none";
        backdrop.style.background = hexToRgba(config.backdrop.color, config.backdrop.alpha);
      }
      updateClipRegion();

      if (visible) {
        canvas.style.display = "block";
        engine.start();
      } else {
        engine.stop();
        canvas.style.display = "none";
      }

      /* 把运行状态报给设置页显示 */
      try {
        document.body.dataset.matrixRainStatus = visible ? "running" : "paused";
        document.body.dataset.matrixRainTask = taskStatus;
        document.body.dataset.matrixRainTps = lastTps == null ? "" : String(lastTps);
      } catch (e) { /* noop */ }

      /* 界面染色跟随 */
      try { applyUiTint(); } catch (e) { warn(e); }
    }

    function hexToRgba(hex, alpha) {
      var rgb = hexToRgb(hex);
      return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + clampI(alpha, 0, 1) + ")";
    }

    /* ═══ 桌面端界面染色:把宿主主题的背景/侧栏 token 向选色混合 ═══════ */
    /* token 定义在 <body>(2026-10-15 实测),读取与覆盖都走 body 内联样式 */
    var TINT_TOKENS = [
      "--dsw-alias-bg-base",
      "--dsw-alias-bg-layer-1",
      "--dsw-alias-bg-layer-2",
      "--dsw-alias-bg-overlay",
      "--dsw-specific-sidebar-fill",
      "--dsw-alias-border-l1",
      "--dsw-alias-border-l2",
    ];
    function applyUiTint() {
      var host = document.body;
      /* 先撤销本皮肤写过的内联覆盖,再按当前配置重算 */
      TINT_TOKENS.forEach(function (t) { host.style.removeProperty(t); });
      var tint = config.uiTint;
      if (!tint || !tint.enabled) return;
      var k = clampI(+tint.strength || 0.25, 0.05, 0.5);
      var pct = Math.round(k * 100);
      var cs = getComputedStyle(host);
      var applied = 0;
      TINT_TOKENS.forEach(function (t) {
        var v = (cs.getPropertyValue(t) || "").trim();
        if (!v) return;
        /* color-mix 免解析:原值可以是 hex/rgb/oklch 任意格式 */
        host.style.setProperty(t, "color-mix(in srgb, " + v + " " + (100 - pct) + "%, " + tint.color + ")");
        applied++;
      });
      if (applied === 0) warn("ui-tint: no theme tokens matched");
    }

    function onConfigChanged() {
      config = readConfig();
      applyPresentation();
    }

    function onCustomization(snapshot) {
      try {
        if (snapshot == null) {
          managerState = { values: { master: true }, visibility: { schedule: true } };
        } else {
          /* 管理器真实回调 = 管理器在线的最强证据 */
          if (!managerOnline) {
            managerOnline = true;
            try { document.body.dataset.matrixRainManager = "yes"; } catch (e) { /* noop */ }
          }
          managerState = {
            values: Object.assign({ master: true }, snapshot.values || {}),
            visibility: Object.assign({ schedule: true }, snapshot.visibility || {}),
          };
        }
        applyPresentation();
      } catch (e) { warn(e); }
    }

    /* ═══ 设置页(设置 → 矩阵雨皮肤) ════════════════════════════════ */
    var PALETTE_PRESETS = [
      { value: "classic-green", label: "经典绿", color: "#00ff41" },
      { value: "cyber-cyan", label: "赛博青", color: "#00ebff" },
      { value: "violet-rain", label: "紫雨", color: "#c878ff" },
      { value: "mono", label: "灰阶", color: "#ebebeb" },
      { value: "amber", label: "琥珀", color: "#ffb300" },
      { value: "blood", label: "血红", color: "#ff2a2a" },
      { value: "rainbow", label: "彩虹", color: "#ff2a2a", grad: "conic-gradient(#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" },
    ];

    function buildSettingsPage(react, jsx) {
      var useState = react.useState, useEffect = react.useEffect, useRef = react.useRef, useCallback = react.useCallback;
      var jsxs = jsx.jsxs, jsx$1 = jsx.jsx;

      var S = {
        page: { maxWidth: 660, display: "flex", flexDirection: "column", gap: 18, paddingTop: 4 },
        card: { border: "1px solid rgba(127,127,127,.3)", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 },
        title: { fontSize: 13, fontWeight: 700, opacity: 0.9 },
        hint: { fontSize: 12, opacity: 0.6, lineHeight: 1.6 },
        row: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 },
        label: { minWidth: 88, flexShrink: 0, opacity: 0.8 },
        value: { minWidth: 44, textAlign: "right", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12, opacity: 0.75 },
        range: { flex: 1, accentColor: "#00c853" },
        radio: { display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" },
        check: { display: "flex", gap: 16, fontSize: 13, flexWrap: "wrap" },
        swatch: { width: 26, height: 26, borderRadius: 6, border: "2px solid transparent", cursor: "pointer", padding: 0 },
        swatchActive: { border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.4)" },
        hexInput: { width: 92, padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(127,127,127,.45)", background: "transparent", color: "inherit", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12 },
        badge: { fontSize: 12, padding: "2px 10px", borderRadius: 999, border: "1px solid rgba(127,127,127,.45)" },
        resetBtn: { alignSelf: "flex-start", padding: "5px 14px", borderRadius: 7, border: "1px solid rgba(127,127,127,.45)", background: "transparent", color: "inherit", fontSize: 12, cursor: "pointer" },
      };

      /* 大颜色圈:canvas 色轮(角度=色相,半径=饱和度) + 亮度滑杆 + RGB 输入 + 常用色 */
      var COMMON_COLORS = ["#000000", "#ffffff", "#00ff41", "#00ebff", "#2563eb", "#c878ff", "#ff2a2a", "#ffb300", "#9aa0a6"];
      function ColorWheel(props) {
        var size = props.size || 190;
        var value = props.value || "#00ff41";
        var onChange = props.onChange;
        var canvasRef = useRef(null);
        var draggingRef = useRef(false);

        var rgb = hexToRgb(value);
        var hsl = rgbToHsl(rgb);
        var hue = hsl[0], sat = hsl[1], light = hsl[2] === 0 ? 0.5 : hsl[2];

        useEffect(function () {
          var cv = canvasRef.current;
          if (!cv) return;
          try {
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            cv.width = size * dpr; cv.height = size * dpr;
            var g = cv.getContext("2d");
            var img = g.createImageData(size * dpr, size * dpr);
            var cx = size * dpr / 2, cy = size * dpr / 2, R = size * dpr / 2 - 2;
            for (var y = 0; y < size * dpr; y++) {
              for (var x = 0; x < size * dpr; x++) {
                var dx = x - cx, dy = y - cy;
                var dist = Math.sqrt(dx * dx + dy * dy);
                var i = (y * size * dpr + x) * 4;
                if (dist > R) { img.data[i + 3] = 0; continue; }
                var h = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
                var s = dist / R;
                var w = hslToRgb(h, s, 0.5);
                img.data[i] = w[0]; img.data[i + 1] = w[1]; img.data[i + 2] = w[2];
                img.data[i + 3] = 255;
              }
            }
            g.putImageData(img, 0, 0);
          } catch (e) { warn(e); }
        }, [size]);

        var pick = useCallback(function (ev) {
          try {
            var cv = canvasRef.current;
            if (!cv) return;
            var rect = cv.getBoundingClientRect();
            var x = ev.clientX - rect.left - rect.width / 2;
            var y = ev.clientY - rect.top - rect.height / 2;
            var R = rect.width / 2 - 2;
            var dist = Math.min(Math.sqrt(x * x + y * y), R);
            var h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
            var s = R > 0 ? dist / R : 0;
            onChange(rgbToHex(hslToRgb(h, s, light)));
          } catch (e) { warn(e); }
        }, [light, onChange]);

        /* 指针在圈上的坐标(用于标记点) */
        var angle = hue * Math.PI / 180;
        var mr = sat * (size / 2 - 2);
        var mx = size / 2 + Math.cos(angle) * mr;
        var my = size / 2 + Math.sin(angle) * mr;

        var rgbInput = function (idx, ch) {
          return jsx$1("input", {
            type: "number", min: 0, max: 255, step: 1, value: rgb[idx],
            style: { width: 52, padding: "3px 5px", borderRadius: 5, border: "1px solid rgba(127,127,127,.45)", background: "transparent", color: "inherit", fontFamily: "ui-monospace,Consolas,monospace", fontSize: 12 },
            onChange: function (e) {
              var v = clampI(parseInt(e.target.value, 10), 0, 255);
              if (!isFinite(v)) return;
              var next = rgb.slice(); next[idx] = v;
              onChange(rgbToHex(next));
            },
          });
        };

        return jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8 }, children: [
          jsxs("div", { style: { display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }, children: [
            jsxs("div", { style: { position: "relative", width: size, height: size, flexShrink: 0 }, children: [
              jsx$1("canvas", {
                ref: canvasRef,
                style: { width: size, height: size, borderRadius: "50%", cursor: "crosshair", touchAction: "none", boxShadow: "0 0 0 1px rgba(127,127,127,.35)" },
                onPointerDown: function (e) { draggingRef.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } pick(e); },
                onPointerMove: function (e) { if (draggingRef.current) pick(e); },
                onPointerUp: function () { draggingRef.current = false; },
                onPointerCancel: function () { draggingRef.current = false; },
              }),
              jsx$1("div", { style: { position: "absolute", left: mx - 6, top: my - 6, width: 12, height: 12, borderRadius: "50%", border: "2px solid #fff", background: value, boxShadow: "0 0 4px rgba(0,0,0,.6)", pointerEvents: "none" } }),
            ] }),
            jsxs("div", { style: { display: "flex", flexDirection: "column", gap: 8, minWidth: 190, flex: 1 }, children: [
              jsxs("div", { style: S.row, children: [
                jsx$1("span", { style: S.label, children: "亮度" }),
                jsx$1("input", { type: "range", min: 0, max: 100, step: 1, value: Math.round(light * 100), style: S.range, onChange: function (e) {
                  var l = +e.target.value / 100;
                  onChange(rgbToHex(hslToRgb(hue, sat, l)));
                } }),
              ] }),
              jsxs("div", { style: S.row, children: [
                jsx$1("span", { style: S.label, children: "RGB" }),
                rgbInput(0), rgbInput(1), rgbInput(2),
              ] }),
              jsxs("div", { style: S.row, children: [
                jsx$1("span", { style: S.label, children: "色值" }),
                jsx$1("input", { style: S.hexInput, value: value, spellCheck: false, onChange: function (e) {
                  var v = e.target.value.trim();
                  if (/^#[0-9a-f]{6}$/i.test(v)) onChange(v.toLowerCase());
                } }),
                jsx$1("span", { style: { fontSize: 11, opacity: 0.5 }, children: value.toLowerCase() }),
              ] }),
              jsxs("div", { style: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }, children: [
                jsx$1("span", { style: Object.assign({}, S.label, { fontSize: 12 }), children: "常用" }),
                COMMON_COLORS.map(function (c) {
                  return jsx$1("button", {
                    key: c, title: c,
                    style: Object.assign({ background: c }, S.swatch, value === c ? S.swatchActive : null),
                    onClick: function () { onChange(c); },
                  });
                }),
              ] }),
              jsx$1("div", { style: S.hint, children: "色圈:角度=色相,半径=饱和度;亮度拉到 0/100 即纯黑/纯白,RGB 可精确输入。选色即切换为自定义色板。" }),
            ] }),
          ] }),
        ] });
      }

      function Slider(props) {
        return jsxs("div", { style: Object.assign({}, S.row, props.disabled ? { opacity: 0.45 } : null), children: [
          jsx$1("span", { style: S.label, children: props.label }),
          jsx$1("input", { type: "range", min: props.min, max: props.max, step: props.step, value: props.value, disabled: !!props.disabled, style: S.range, onChange: function (e) { props.onChange(+e.target.value); } }),
          jsx$1("span", { style: S.value, children: props.display }),
        ] });
      }

      function SettingsPage() {
        var cfg = useState(function () { return readConfig(); });
        var config = cfg[0], setConfigState = cfg[1];
        var live = useState(function () { return { status: "?", tps: "", task: "", manager: "", ws: "" }; });
        var liveState = live[0], setLive = live[1];

        useEffect(function () {
          var onUpdate = function () { setConfigState(readConfig()); };
          window.addEventListener(CONFIG_EVENT, onUpdate);
          window.addEventListener("storage", onUpdate);
          var timer = setInterval(function () {
            setLive({
              status: document.body.dataset.matrixRainStatus || "?",
              tps: document.body.dataset.matrixRainTps || "",
              task: document.body.dataset.matrixRainTask || "",
              manager: document.body.dataset.matrixRainManager || "",
              ws: document.body.dataset.matrixRainWs || "",
            });
          }, 1000);
          return function () {
            window.removeEventListener(CONFIG_EVENT, onUpdate);
            window.removeEventListener("storage", onUpdate);
            clearInterval(timer);
          };
        }, []);

        var set = function (partial) {
          setConfigState(writeConfig(partial));
          /* 调参即时预览:任何修改都让雨强制现身几秒,直观看到效果 */
          try { window.dispatchEvent(new CustomEvent(PREVIEW_EVENT, { detail: { ms: 4000 } })); } catch (e) { warn(e); }
        };
        var inter = config.interactions || [];
        var taskLabel = { standby: "待机", syncing: "提交中", working: "任务运行中", approval: "等待授权", review: "等待审阅", input: "等待输入", complete: "任务完成", fault: "出错", ready: "就绪" };

        return jsxs("div", { style: S.page, children: [
          jsxs("div", { style: S.card, children: [
            jsxs("div", { style: S.row, children: [
              jsx$1("span", { style: { fontSize: 14, fontWeight: 700 }, children: "矩阵雨 · MATRIX RAIN" }),
              jsx$1("span", { style: Object.assign({}, S.badge, { color: liveState.status === "running" ? "#16a34a" : "inherit" }), children: (liveState.status === "running" ? "雨落中" : "已停") + " · " + (taskLabel[liveState.task] || liveState.task || "?") + (liveState.ws === "1" ? "+工作区" : "") + (liveState.tps ? " · " + liveState.tps + " tok/s" : "") }),
            ] }),
            jsx$1("label", { style: S.row, children: [
              jsx$1("input", { type: "checkbox", checked: !!config.master, onChange: function (e) { set({ master: e.target.checked }); } }),
              jsx$1("span", { children: "总开关(皮肤管理面板里另有一个,两者串联)" }),
            ] }),
            jsx$1("div", { style: S.hint, children: liveState.manager === "yes"
              ? "独立运行模式:雨层与当前皮肤共存互不影响;启停用 设置→插件 页开关本插件。"
              : "独立运行模式:雨层可与任何皮肤叠加;启停用 设置→插件 页开关本插件。" }),
          ] }),

          jsxs("div", { style: S.card, children: [
            jsx$1("div", { style: S.title, children: "何时下落" }),
            jsxs("div", { style: S.radio, children: [
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-timing", checked: config.timing === "always", onChange: function () { set({ timing: "always" }); } }), " 随时下落"] }),
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-timing", checked: config.timing === "task", onChange: function () { set({ timing: "task" }); } }), " 仅任务执行时下落"] }),
            ] }),
            jsx$1("label", { style: S.row, children: [
              jsx$1("input", { type: "checkbox", checked: !!config.tpsAdaptive, disabled: config.timing !== "task", onChange: function (e) { set({ tpsAdaptive: e.target.checked }); } }),
              jsx$1("span", { style: { opacity: config.timing === "task" ? 1 : 0.5 }, children: "速度跟随任务 TPS 自适应(生成越快雨越急)" }),
            ] }),
            jsxs("div", { style: S.radio, children: [
              jsx$1("span", { style: S.label, children: "雨幕区域" }),
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-area", checked: config.rainArea === "full", onChange: function () { set({ rainArea: "full" }); } }), " 全窗口"] }),
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-area", checked: config.rainArea === "transcript", onChange: function () { set({ rainArea: "transcript" }); } }), " 对话区"] }),
            ] }),
            jsx$1("div", { style: S.hint, children: "「仅任务执行时」:检测到 agent 正在工作(含等待授权/确认)才落雨,任务结束自动停;空闲时界面保持清爽。" }),
          ] }),

          jsxs("div", { style: S.card, children: [
            jsx$1("div", { style: S.title, children: "雨的形态" }),
            jsx$1(Slider, { label: "速度倍率", min: 50, max: 400, step: 10, value: Math.round(config.speedMult * 100), display: Math.round(config.speedMult * 100) + "%", disabled: config.timing === "task" && !!config.tpsAdaptive, onChange: function (v) { set({ speedMult: v / 100 }); } }),
            jsx$1(Slider, { label: "冲击波速", min: 5, max: 120, step: 5, value: clampI(+config.shockSpeed || 50, 5, 120), display: (clampI(+config.shockSpeed || 50, 5, 120)) + "", onChange: function (v) { set({ shockSpeed: v }); } }),
            jsx$1(Slider, { label: "雨量", min: 15, max: 100, step: 5, value: Math.round(config.density * 100), display: Math.round(config.density * 100) + "%", onChange: function (v) { set({ density: v / 100 }); } }),
            jsx$1(Slider, { label: "字号", min: 70, max: 160, step: 5, value: Math.round(config.glyphScale * 100), display: Math.round(config.glyphScale * 100) + "%", onChange: function (v) { set({ glyphScale: v / 100 }); } }),
            jsx$1(Slider, { label: "雨幕浓度", min: 20, max: 100, step: 5, value: Math.round(config.opacity * 100), display: Math.round(config.opacity * 100) + "%", onChange: function (v) { set({ opacity: v / 100 }); } }),
            jsx$1("div", { style: S.hint, children: "跟随 TPS 时速度纯由任务吞吐决定(倍率滑杆暂停生效,仅非跟随模式使用);等效速度超 250 tok/s 触发随机高亮;冲击波速独立于雨速,调参预览期间也可以点屏幕试波。「仅任务执行时」= 本工作区任意会话在跑(含后台任务)即下雨。" }),
            jsxs("div", { style: S.check, children: [
              jsx$1("span", { style: S.label, children: "交互" }),
              jsx$1("label", { children: [jsx$1("input", { type: "checkbox", checked: inter.indexOf("shock") >= 0, onChange: function (e) {
                var next = e.target.checked ? inter.concat(["shock"]) : inter.filter(function (v) { return v !== "shock"; });
                set({ interactions: next });
              } }), " 左键冲击波"] }),
              jsx$1("label", { children: [jsx$1("input", { type: "checkbox", checked: inter.indexOf("glow") >= 0, onChange: function (e) {
                var next = e.target.checked ? inter.concat(["glow"]) : inter.filter(function (v) { return v !== "glow"; });
                set({ interactions: next });
              } }), " 鼠标光晕"] }),
            ] }),
          ] }),

          jsxs("div", { style: S.card, children: [
            jsx$1("div", { style: S.title, children: "字符颜色" }),
            jsxs("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }, children:
              PALETTE_PRESETS.map(function (p) {
                return jsx$1("button", {
                  key: p.value, title: p.label,
                  style: Object.assign({ background: p.grad || p.color }, S.swatch, config.palette === p.value ? S.swatchActive : null),
                  onClick: function () { set({ palette: p.value, glyphColor: p.color }); },
                });
              }).concat([
                jsx$1("button", {
                  key: "custom", title: "自定义(下方色圈)",
                  style: Object.assign({ background: config.glyphColor }, S.swatch, config.palette === "custom" ? S.swatchActive : null),
                  onClick: function () { set({ palette: "custom" }); },
                }),
              ])
            }),
            jsx$1(ColorWheel, {
              value: config.glyphColor,
              onChange: function (hex) { set({ palette: "custom", glyphColor: hex }); },
            }),
            jsx$1("div", { style: S.hint, children: "彩虹 = 逐格流转的动态光谱;浅色界面建议偏深色并配合「压印」;深色界面随意。" }),
          ] }),

          jsxs("div", { style: S.card, children: [
            jsx$1("div", { style: S.title, children: "背景衬色(可选,增强字符对比)" }),
            jsx$1("label", { style: S.row, children: [
              jsx$1("input", { type: "checkbox", checked: !!config.backdrop.enabled, onChange: function (e) { set({ backdrop: Object.assign({}, config.backdrop, { enabled: e.target.checked }) }); } }),
              jsx$1("span", { children: "启用背景衬色层(默认关)" }),
            ] }),
            jsx$1(ColorWheel, {
              value: config.backdrop.color,
              onChange: function (hex) { set({ backdrop: Object.assign({}, config.backdrop, { color: hex }) }); },
            }),
            jsx$1(Slider, { label: "衬色浓度", min: 0, max: 85, step: 5, value: Math.round(config.backdrop.alpha * 100), display: Math.round(config.backdrop.alpha * 100) + "%", onChange: function (v) { set({ backdrop: Object.assign({}, readConfig().backdrop, { alpha: v / 100 }) }); } }),
            jsx$1("div", { style: S.hint, children: "衬色只铺在雨幕区域内(雨幕区域=全窗口时才是全窗),不再让整个界面变暗;不想要对比增强就保持关闭。" }),
            jsxs("div", { style: S.row, children: [
              jsx$1("span", { style: S.label, children: "叠加方式" }),
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-blend", checked: config.blend === "auto", onChange: function () { set({ blend: "auto" }); } }), " 自动"] }),
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-blend", checked: config.blend === "screen", onChange: function () { set({ blend: "screen" }); } }), " 荧幕(深色)"] }),
              jsx$1("label", { children: [jsx$1("input", { type: "radio", name: "mr-blend", checked: config.blend === "multiply", onChange: function () { set({ blend: "multiply" }); } }), " 压印(浅色)"] }),
            ] }),
          ] }),

          jsxs("div", { style: S.card, children: [
            jsx$1("div", { style: S.title, children: "界面染色(整个客户端跟随变色)" }),
            jsx$1("label", { style: S.row, children: [
              jsx$1("input", { type: "checkbox", checked: !!config.uiTint.enabled, onChange: function (e) { set({ uiTint: Object.assign({}, config.uiTint, { enabled: e.target.checked }) }); } }),
              jsx$1("span", { children: "把界面背景/侧栏/边框向选色混合(文字颜色不动)" }),
            ] }),
            jsx$1(ColorWheel, {
              value: config.uiTint.color,
              onChange: function (hex) { set({ uiTint: Object.assign({}, config.uiTint, { color: hex }) }); },
            }),
            jsx$1(Slider, { label: "染色强度", min: 5, max: 50, step: 5, value: Math.round(config.uiTint.strength * 100), display: Math.round(config.uiTint.strength * 100) + "%", onChange: function (v) { set({ uiTint: Object.assign({}, readConfig().uiTint, { strength: v / 100 }) }); } }),
            jsx$1("div", { style: S.hint, children: "作用于 DSH 主题的背景/侧栏/浮层/边框 token,深浅色主题都跟随,切换皮肤或关闭即还原;这是最有效的字符对比增强。" }),
          ] }),

          jsxs("div", { style: { display: "flex", gap: 10, alignItems: "center" }, children: [
            jsx$1("button", { style: S.resetBtn, onClick: function () {
              try { localStorage.removeItem(CONFIG_KEY); } catch (e) { warn(e); }
              setConfigState(writeConfig({}));
            }, children: "恢复默认" }),
            jsx$1("span", { style: S.hint, children: "切换皮肤请前往 设置 → 皮肤管理;配置即时生效并保存在本浏览器。" }),
          ] }),
        ] });
      }
      return SettingsPage;
    }

    function registerSettingsPage(ctx) {
      if (!ctx || !ctx.slots || typeof ctx.slots.inject !== "function") return;
      var react = require("react");
      var jsxRuntime = require("react/jsx-runtime");
      var Page = buildSettingsPage(react, jsxRuntime);
      var dispose = ctx.slots.inject("settings.section", function () {
        return ctx.slots.register({
          name: "settings.section",
          id: "matrix-rain",
          order: 130,
          label: function () { return "矩阵雨皮肤"; },
          inject: function () { return {}; },
        }, Page);
      });
      if (typeof dispose === "function") registerCleanup(dispose);
    }

    /* ═══ 装配 ══════════════════════════════════════════════════════ */
    function applyInner(ctx) {
      var body = document.body;
      if (!body) return;

      /* HMR/异常重入:扫除上一实例可能的残留 */
      var leftovers = body.querySelectorAll(
        '[data-skin-chrome="matrix-rain"],[data-skin-chrome="matrix-rain-backdrop"]'
      );
      for (var i = 0; i < leftovers.length; i++) leftovers[i].remove();
      body.removeAttribute("data-dsh-matrix-rain");

      /* 1. 作用域属性(皮肤管理器契约) */
      body.setAttribute("data-dsh-matrix-rain", "");
      registerCleanup(function () {
        body.removeAttribute("data-dsh-matrix-rain");
        /* 界面染色还原 */
        TINT_TOKENS.forEach(function (t) { body.style.removeProperty(t); });
      });

      /* 2. 背景衬色层(在画布之下,用于增强字符对比) */
      backdrop = document.createElement("div");
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.dataset.skinChrome = "matrix-rain-backdrop";
      backdrop.style.cssText =
        "position:fixed;inset:0;z-index:2147483639;pointer-events:none;display:block;";
      body.appendChild(backdrop);
      registerCleanup(function () { backdrop.remove(); backdrop = null; });

      /* 3. 雨画布(置顶叠加,永不接收指针) */
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.dataset.skinChrome = "matrix-rain";
      canvas.style.cssText =
        "position:fixed;inset:0;width:100vw;height:100vh;display:block;" +
        "z-index:2147483640;pointer-events:none;mix-blend-mode:screen;opacity:.65;";
      body.appendChild(canvas);
      registerCleanup(function () { canvas.remove(); canvas = null; });

      /* 4. 引擎:reduced-motion → 静态一帧 */
      var reduced = false;
      try {
        reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (e) { /* 无 matchMedia 则正常动起来 */ }
      engine = MR.createEngine({
        canvas: canvas,
        mode: "overlay",
        palette: "classic-green",
        staticFrame: reduced,
      });
      registerCleanup(function () {
        try { engine.destroy(); } catch (e) { /* 已销毁则忽略 */ }
        engine = null;
      });
      engine.init(false);

      /* 5. 配置变化(设置页 / 跨标签页)+ 预览窗口 */
      var onStorage = function (ev) { if (ev.key === CONFIG_KEY) onConfigChanged(); };
      var onPreview = function (ev) {
        try { startPreview(ev && ev.detail && ev.detail.ms ? ev.detail.ms : 4000); } catch (e) { warn(e); }
      };
      window.addEventListener(CONFIG_EVENT, onConfigChanged);
      window.addEventListener("storage", onStorage);
      window.addEventListener(PREVIEW_EVENT, onPreview);
      registerCleanup(function () {
        window.removeEventListener(CONFIG_EVENT, onConfigChanged);
        window.removeEventListener("storage", onStorage);
        window.removeEventListener(PREVIEW_EVENT, onPreview);
        clearTimeout(previewTimer);
      });

      /* 6. 窗口尺寸变化 → 防抖重建 */
      var resizeTimer = 0;
      var onResize = function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function () {
          try { engine.resize(); applyPresentation(); } catch (e) { warn(e); }
        }, 200);
      };
      window.addEventListener("resize", onResize);
      registerCleanup(function () {
        window.removeEventListener("resize", onResize);
        clearTimeout(resizeTimer);
      });

      /* 7. 交互:指针移动光晕 + 左键冲击波(passive,不拦截原生行为)
             预览期间无视开关门控——调参时正好试波 */
      var interactionAllowed = function () {
        return inPreview() || (!!config.master && !!managerState.values.master);
      };
      var onMove = function (ev) {
        if (!interactionAllowed()) return;
        var inter = config.interactions || [];
        if (inter.indexOf("glow") < 0) return;
        try { engine.lightAt(ev.clientX, ev.clientY); } catch (e) { warn(e); }
      };
      var onDown = function (ev) {
        if (ev.button !== 0) return;
        if (!interactionAllowed()) return;
        var inter = config.interactions || [];
        if (inter.indexOf("shock") < 0) return;
        try { engine.shock(ev.clientX, ev.clientY); } catch (e) { warn(e); }
      };
      window.addEventListener("pointermove", onMove, { capture: true, passive: true });
      window.addEventListener("pointerdown", onDown, { capture: true, passive: true });
      registerCleanup(function () {
        window.removeEventListener("pointermove", onMove, { capture: true });
        window.removeEventListener("pointerdown", onDown, { capture: true });
      });

      /* 8. 任务状态观察(orca 配方,节流版)+ TPS 轮询 + 区域/衬色跟随 */
      /* 注意:必须用节流而非防抖 —— 流式生成时 DOM 突变连绵不断,防抖会把
         状态求值无限推迟(实踩:任务跑着雨不下的根因)。节流保证连续突变下
         每 ≤150ms 必求值一次;700ms 轮询再兜一层底。 */
      var syncScheduled = false;
      var runSync = function () {
        var next = "standby";
        try { next = resolveTaskStatus(body); } catch (e) { warn(e); }
        var wsRun = false;
        try { wsRun = workspaceHasRunning(body); } catch (e) { warn(e); }
        if (next !== taskStatus || wsRun !== workspaceRunning) {
          taskStatus = next;
          workspaceRunning = wsRun;
          applyPresentation();
        }
      };
      var scheduleSync = function () {
        if (syncScheduled) return;
        syncScheduled = true;
        setTimeout(function () {
          syncScheduled = false;
          runSync();
        }, 150);
      };
      var observer = new MutationObserver(function (records) {
        /* 只对宿主状态属性/结构变化反应,忽略画布自身 */
        for (var i = 0; i < records.length; i++) {
          var t = records[i].target;
          if (t === canvas || t === backdrop || (t.parentNode === body && t.hasAttribute && t.hasAttribute("data-skin-chrome"))) continue;
          scheduleSync();
          break;
        }
      });
      observer.observe(body, {
        childList: true, subtree: true,
        attributes: true,
        attributeFilter: ["data-phase", "data-state", "aria-disabled", "aria-selected"],
      });
      registerCleanup(function () { observer.disconnect(); });

      var pollTimer = setInterval(function () {
        try {
          runSync(); /* 兜底:即使观察器全失效也每 700ms 校正一次任务态 */
          var wantTps = config.timing === "task" && config.tpsAdaptive && TASK_ACTIVE_STATES[taskStatus];
          if (wantTps) {
            var t = readTps(body);
            if (t != null && t !== lastTps) {
              lastTps = t;
            }
          }
          applyPresentation(); /* 无条件重估:断雨宽限到期也要真正关掉 */
          updateClipRegion();
          try {
            document.body.dataset.matrixRainTask = taskStatus;
            document.body.dataset.matrixRainWs = workspaceRunning ? "1" : "0";
          } catch (e) { /* noop */ }
        } catch (e) { warn(e); }
      }, 700);
      registerCleanup(function () { clearInterval(pollTimer); });

      /* 9. 主题热切换(auto 叠加跟随系统亮暗) */
      var colorScheme = null;
      try {
        colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
        var onScheme = function () { applyPresentation(); }; /* 亮暗切换:叠加方式与界面染色都重算 */
        if (colorScheme.addEventListener) {
          colorScheme.addEventListener("change", onScheme);
          registerCleanup(function () { colorScheme.removeEventListener("change", onScheme); });
        }
      } catch (e) { /* 跳过 */ }

      /* 10. 皮肤管理器在线感知 + 定制面板(仅总开关;完整设置在设置页)
              感知双通道:管理器的 ready/register 广播,或它回调 apply(snapshot) */
      var onManagerSignal = function () {
        if (managerOnline) return;
        managerOnline = true;
        try { document.body.dataset.matrixRainManager = "yes"; } catch (e) { /* noop */ }
      };
      window.addEventListener(SKIN_CUSTOMIZATION_EVENTS[2].ready, onManagerSignal);
      window.addEventListener(SKIN_CUSTOMIZATION_EVENTS[2].register, onManagerSignal);
      registerCleanup(function () {
        window.removeEventListener(SKIN_CUSTOMIZATION_EVENTS[2].ready, onManagerSignal);
        window.removeEventListener(SKIN_CUSTOMIZATION_EVENTS[2].register, onManagerSignal);
      });
      try { document.body.dataset.matrixRainManager = ""; } catch (e) { /* noop */ }
      var managerProbeTimer = setTimeout(function () {
        if (!managerOnline) {
          try { document.body.dataset.matrixRainManager = "no"; } catch (e) { /* noop */ }
        }
      }, 2500);
      registerCleanup(function () { clearTimeout(managerProbeTimer); });

      /* v0.5.0 起独立运行:不再向皮肤管理器注册定制面板(避免在皮肤管理页出现
         不可切换的孤儿卡片),雨与任何皮肤共存;总开关在设置页。
         onCustomization(null) 仅用于初始化默认门控。 */

      /* 11. 设置页注入(设置侧边栏 → 矩阵雨皮肤);失败不影响雨 */
      try { registerSettingsPage(ctx); }
      catch (e) { warn("settings page skipped: " + (e && e.message ? e.message : e)); }

      /* 12. 初始默认 */
      onCustomization(null);
      onConfigChanged();

      installed = true;
    }

    function apply(ctx) {
      try {
        applyInner(ctx);
      } catch (e) {
        runCleanups();
        installed = false;
        warn(e);
      }
      if (installed && ctx && typeof ctx.effect === "function") {
        try {
          ctx.effect(function () {
            return function () { runCleanups(); };
          }, "ui-skin-matrix-rain: chrome");
        } catch (e) { warn(e); }
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
