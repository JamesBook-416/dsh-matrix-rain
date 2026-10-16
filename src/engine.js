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
