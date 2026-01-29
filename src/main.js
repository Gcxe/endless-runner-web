/* endless_runner.js (polished)
   Requires an HTML file containing: <canvas id="c"></canvas><script src="endless_runner.js"></script>
*/

(() => {
  "use strict";

  // -------------------------
  // Constants + helpers
  // -------------------------
  const GAME_W = 960, GAME_H = 540;
  const WIDTH = GAME_W, HEIGHT = GAME_H;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (t) => t * t * (3 - 2 * t);
  const randf = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const TAU = Math.PI * 2;

  function makeLCG(seed = 1) {
    let s = seed >>> 0;
    return () => {
      s = (1664525 * s + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  // -------------------------
  // Canvas + view offsets + HiDPI
  // -------------------------
  const canvas = document.getElementById("c");
  if (!canvas) throw new Error("Missing <canvas id='c'></canvas> in HTML.");
  const ctx = canvas.getContext("2d");

  let VIEW_OX = 0, VIEW_OY = 0;
  let WIN_W = 0, WIN_H = 0;
  let DPR = 1;

  function applyDisplayMode() {
    WIN_W = window.innerWidth;
    WIN_H = window.innerHeight;

    DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1)); // cap for performance
    canvas.width = Math.floor(WIN_W * DPR);
    canvas.height = Math.floor(WIN_H * DPR);
    canvas.style.width = WIN_W + "px";
    canvas.style.height = WIN_H + "px";

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    VIEW_OX = Math.floor((WIN_W - GAME_W) / 2);
    VIEW_OY = Math.floor((WIN_H - GAME_H) / 2);

    document.title = "Endless Runner";
  }
  window.addEventListener("resize", applyDisplayMode);
  applyDisplayMode();

  // -------------------------
  // Colors
  // -------------------------
  const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  const GROUND = [70, 220, 140];
  const COIN_C = [255, 215, 90];
  const TEXT = [240, 240, 245];
  const DIM = [200, 200, 210];

  // -------------------------
  // Save system (localStorage)
  // -------------------------
  const SAVE_KEY = "runner_save_v2_polished";

  function defaultSaveData() {
    return {
      money: 0,
      best_score: 0,
      cosmetics: { player: "Sky", platform: "Pearl", spike: "Crimson", background: "Midnight" },
      owned: { player: ["Sky"], platform: ["Pearl"], spike: ["Crimson"], background: ["Midnight"] },
      upgrades: { jump: 0, coyote: 0, coin_mult: 0, magnet: 0 },
      settings: {
        screenshake: true,
        particles: true,
        show_fps: false,
        fullscreen: false,
        sound: true, // NEW
      },
    };
  }

  function deepMerge(dst, src) {
    for (const k of Object.keys(src)) {
      const v = src[k];
      if (!(k in dst)) dst[k] = v;
      else if (
        v && typeof v === "object" && !Array.isArray(v) &&
        dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k])
      ) deepMerge(dst[k], v);
    }
  }

  function saveSave(data) {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (_) {}
  }

  function loadSave() {
    const def = defaultSaveData();
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return def;
      const data = JSON.parse(raw);
      deepMerge(data, def);
      return data;
    } catch (_) { return def; }
  }

  let SAVE = loadSave();

  async function setFullscreen(on) {
    SAVE.settings.fullscreen = !!on;
    saveSave(SAVE);
    try {
      if (on) {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      } else {
        if (document.fullscreenElement) await document.exitFullscreen();
      }
    } catch (_) {}
    applyDisplayMode();
  }

  document.addEventListener("fullscreenchange", () => {
    const isFs = !!document.fullscreenElement;
    if (SAVE.settings.fullscreen !== isFs) {
      SAVE.settings.fullscreen = isFs;
      saveSave(SAVE);
    }
    applyDisplayMode();
  });

  // -------------------------
  // Simple WebAudio SFX (no assets)
  // -------------------------
  let audioCtx = null;

  function ensureAudio() {
    if (!SAVE.settings.sound) return null;
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { audioCtx = null; }
    }
    return audioCtx;
  }

  function beep(freq, dur = 0.07, type = "sine", gain = 0.03) {
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const g = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  const sfx = {
    click: () => beep(650, 0.06, "triangle", 0.02),
    jump:  () => { beep(420, 0.05, "square", 0.02); beep(740, 0.04, "sine", 0.015); },
    coin:  () => { beep(980, 0.05, "sine", 0.02); beep(1280, 0.05, "triangle", 0.015); },
    dead:  () => { beep(160, 0.12, "sawtooth", 0.03); beep(90, 0.16, "square", 0.02); },
  };

  // Resume audio on first interaction (browser policy)
  function unlockAudio() {
    const ac = ensureAudio();
    if (ac && ac.state === "suspended") ac.resume().catch(() => {});
  }
  window.addEventListener("pointerdown", unlockAudio, { once: true });
  window.addEventListener("keydown", unlockAudio, { once: true });

  // -------------------------
  // Cosmetics + upgrades
  // -------------------------
  const COSMETICS = {
    player: {
      Sky: { price: 0, color: [120, 200, 255] },
      Neon: { price: 200, color: [100, 255, 180] },
      Gold: { price: 400, color: [255, 215, 90] },
      Violet: { price: 300, color: [190, 120, 255] },
      Void: { price: 600, color: [30, 35, 48] },
    },
    platform: {
      Pearl: { price: 0, color: [210, 210, 220] },
      Stone: { price: 150, color: [170, 175, 185] },
      Mint: { price: 250, color: [150, 255, 210] },
      Amber: { price: 300, color: [255, 190, 120] },
      Obsidian: { price: 500, color: [55, 60, 70] },
    },
    spike: {
      Crimson: { price: 0, color: [255, 90, 90] },
      Acid: { price: 180, color: [170, 255, 80] },
      Ice: { price: 220, color: [140, 220, 255] },
      Royal: { price: 320, color: [210, 130, 255] },
      Coal: { price: 450, color: [70, 75, 85] },
    },
    background: {
      Midnight: { price: 0, color: [16, 18, 24] },
      Dusk: { price: 180, color: [24, 20, 30] },
      Ocean: { price: 220, color: [10, 22, 32] },
      Forest: { price: 260, color: [14, 26, 20] },
      Sunset: { price: 320, color: [28, 16, 18] },
    },
  };

  const UPGRADES = {
    jump: { name: "Jump Power", max: 6, base_cost: 140, cost_step: 80 },
    coyote: { name: "Coyote Time", max: 6, base_cost: 110, cost_step: 70 },
    coin_mult: { name: "Coin Multiplier", max: 6, base_cost: 170, cost_step: 90 },
    magnet: { name: "Coin Magnet", max: 6, base_cost: 160, cost_step: 85 },
  };

  const upgradeCost = (key, level) => UPGRADES[key].base_cost + UPGRADES[key].cost_step * level;
  const getColor = (cat) => COSMETICS[cat][SAVE.cosmetics[cat]].color;

  function isOwned(cat, name) { return SAVE.owned[cat].includes(name); }

  function buyCosmetic(cat, name) {
    if (isOwned(cat, name)) {
      SAVE.cosmetics[cat] = name;
      saveSave(SAVE);
      sfx.click();
      return;
    }
    const price = COSMETICS[cat][name].price;
    if (SAVE.money >= price) {
      SAVE.money -= price;
      SAVE.owned[cat].push(name);
      SAVE.cosmetics[cat] = name;
      saveSave(SAVE);
      sfx.click();
    }
  }

  function buyUpgrade(key) {
    const level = SAVE.upgrades[key];
    if (level >= UPGRADES[key].max) return;
    const cost = upgradeCost(key, level);
    if (SAVE.money >= cost) {
      SAVE.money -= cost;
      SAVE.upgrades[key] += 1;
      saveSave(SAVE);
      sfx.click();
    }
  }

  function toggleSetting(key) {
    SAVE.settings[key] = !SAVE.settings[key];
    saveSave(SAVE);
    sfx.click();
    if (key === "fullscreen") setFullscreen(SAVE.settings.fullscreen);
  }

  function resetSaveToDefaults() {
    SAVE = defaultSaveData();
    saveSave(SAVE);
    setFullscreen(false);
    paused = false;
    mode = MODE_MENU;
    resetRun();
  }

  // -------------------------
  // Rect helpers
  // -------------------------
  const rect = (x, y, w, h) => ({ x, y, w, h });
  const copyRect = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h });
  const centerx = (r) => r.x + r.w / 2;
  const centery = (r) => r.y + r.h / 2;

  function colliderect(a, b) {
    return (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y);
  }

  // -------------------------
  // Drawing primitives
  // -------------------------
  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function roundRectFill(x, y, w, h, radius, fillCol, strokeCol = null, strokeW = 2) {
    roundRectPath(x, y, w, h, radius);
    ctx.fillStyle = rgb(fillCol);
    ctx.fill();
    if (strokeCol) {
      ctx.lineWidth = strokeW;
      ctx.strokeStyle = rgb(strokeCol);
      ctx.stroke();
    }
  }

  function softShadow(on) {
    if (!on) {
      ctx.shadowColor = "transparent";
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      return;
    }
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 14;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
  }

  function drawText(s, x, y, size = 34, color = TEXT, align = "left", alpha = 1) {
    ctx.globalAlpha = alpha;
    ctx.font = `${size}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    ctx.fillStyle = rgb(color);
    ctx.textBaseline = "top";
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
    ctx.globalAlpha = 1;
  }

  // -------------------------
  // UI Button (hover + press feel)
  // -------------------------
  class Button {
    constructor(r, label, onClick, style = "main") {
      this.r = r;
      this.label = label;
      this.onClick = onClick;
      this.style = style;
      this.pressT = 0;
    }

    draw(mx, my, dt) {
      const hover = (mx >= this.r.x && mx <= this.r.x + this.r.w && my >= this.r.y && my <= this.r.y + this.r.h);
      this.pressT = Math.max(0, this.pressT - dt * 5);

      let bg, border, txtc;
      if (this.style === "main") {
        bg = hover ? [58, 64, 86] : [40, 44, 58];
        border = [120, 126, 150];
        txtc = [248, 248, 252];
      } else {
        bg = hover ? [52, 58, 80] : [34, 38, 52];
        border = [100, 106, 132];
        txtc = [242, 242, 246];
      }

      const p = smoothstep(this.pressT);
      const inset = 2 + 3 * p;
      const rx = this.r.x + inset;
      const ry = this.r.y + inset;
      const rw = this.r.w - inset * 2;
      const rh = this.r.h - inset * 2;

      softShadow(true);
      roundRectFill(rx, ry, rw, rh, 14, bg, border, 2);
      softShadow(false);

      ctx.font = `34px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      ctx.fillStyle = rgb(txtc);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(this.label, this.r.x + this.r.w / 2, this.r.y + this.r.h / 2 + (p * 1.5));
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
    }

    tryClick(mx, my) {
      if (mx >= this.r.x && mx <= this.r.x + this.r.w && my >= this.r.y && my <= this.r.y + this.r.h) {
        this.pressT = 1;
        this.onClick();
        return true;
      }
      return false;
    }
  }

  // -------------------------
  // Particles (with slight drag for polish)
  // -------------------------
  class Particle {
    constructor(x, y, vx, vy, life, r, col) {
      this.x = x; this.y = y;
      this.vx = vx; this.vy = vy;
      this.life = life;
      this.r = r;
      this.col = col;
      this.maxLife = life;
    }
  }

  function spawnParticles(particles, x, y, n, spMin, spMax, lifeMin, lifeMax, rMin, rMax, col, up = false) {
    for (let i = 0; i < n; i++) {
      const ang = up ? randf(-Math.PI, 0) : randf(0, TAU);
      const sp = randf(spMin, spMax);
      particles.push(new Particle(
        x, y,
        Math.cos(ang) * sp,
        Math.sin(ang) * sp,
        randf(lifeMin, lifeMax),
        randf(rMin, rMax),
        col
      ));
    }
  }

  function updateParticles(particles, dt) {
    if (!SAVE.settings.particles) { particles.length = 0; return; }
    const g = 1600.0;
    const drag = 0.985;
    const alive = [];
    for (const p of particles) {
      p.life -= dt;
      if (p.life > 0) {
        p.vy += g * dt;
        p.vx *= Math.pow(drag, dt * 60);
        p.vy *= Math.pow(drag, dt * 60);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        alive.push(p);
      }
    }
    particles.length = 0;
    particles.push(...alive);
  }

  // -------------------------
  // Background parallax (add subtle gradient overlay)
  // -------------------------
  function drawParallax(camX, t) {
    ctx.fillStyle = rgb(getColor("background"));
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // subtle top-to-bottom vignette/gradient
    const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
    grad.addColorStop(0, "rgba(255,255,255,0.05)");
    grad.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const rng = makeLCG(1);

    // stars
    for (let i = 0; i < 80; i++) {
      const sx = (i * 173) % (WIDTH * 3);
      const sy = 30 + (i * 97) % Math.floor(HEIGHT / 2);
      const px = Math.floor(((sx - camX * 0.18) % (WIDTH + 60)) - 30);
      const tw = 170 + Math.floor(60 * Math.sin(t * 2.1 + i));
      ctx.fillStyle = `rgb(${tw},${tw},${tw})`;
      ctx.beginPath();
      ctx.arc(px, sy, 1, 0, TAU);
      ctx.fill();
      rng();
    }

    // far blobs
    for (let i = 0; i < 8; i++) {
      const x = i * 220;
      const y = HEIGHT - 220;
      const px = Math.floor(((x - camX * 0.28) % (WIDTH + 260)) - 130);
      ctx.fillStyle = rgb([28, 34, 48]);
      ctx.beginPath();
      ctx.arc(px, y, 160, 0, TAU);
      ctx.fill();
    }

    // near blobs
    for (let i = 0; i < 10; i++) {
      const x = i * 190;
      const y = HEIGHT - 160;
      const px = Math.floor(((x - camX * 0.45) % (WIDTH + 260)) - 130);
      ctx.fillStyle = rgb([24, 30, 44]);
      ctx.beginPath();
      ctx.arc(px, y, 130, 0, TAU);
      ctx.fill();
    }
  }

  // -------------------------
  // Spike draw
  // -------------------------
  function spikeDraw(r, col) {
    const baseY = r.y + r.h;
    const spikeH = Math.max(14, r.h);
    const apexY = baseY - spikeH;
    const teeth = Math.max(3, Math.floor(r.w / 20));
    const segW = r.w / teeth;

    ctx.fillStyle = rgb(col);

    for (let i = 0; i < teeth; i++) {
      const x0 = r.x + i * segW;
      const x1 = r.x + (i + 1) * segW;
      const xm = (x0 + x1) / 2;

      ctx.beginPath();
      ctx.moveTo(Math.floor(x0), Math.floor(baseY));
      ctx.lineTo(Math.floor(x1), Math.floor(baseY));
      ctx.lineTo(Math.floor(xm), Math.floor(apexY));
      ctx.closePath();
      ctx.fill();
    }

    ctx.strokeStyle = rgba(col, 0.9);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(r.x, baseY);
    ctx.lineTo(r.x + r.w, baseY);
    ctx.stroke();
  }

  // -------------------------
  // Collision: vertical sweep
  // -------------------------
  function collideVerticalSweep(player, pyFloat, dy, platforms) {
    if (dy === 0) return { pyFloat, landed: false, bumped: false };

    const steps = Math.floor(Math.abs(dy) / 6) + 1;
    const step = dy / steps;

    for (let s = 0; s < steps; s++) {
      const prevTop = player.y;
      const prevBottom = player.y + player.h;

      pyFloat += step;
      player.y = Math.floor(pyFloat);

      if (step > 0) {
        for (const p of platforms) {
          if (colliderect(player, p) && prevBottom <= p.y) {
            player.y = p.y - player.h;
            return { pyFloat: player.y, landed: true, bumped: false };
          }
        }
      } else {
        for (const p of platforms) {
          if (colliderect(player, p) && prevTop >= p.y + p.h) {
            player.y = p.y + p.h;
            return { pyFloat: player.y, landed: false, bumped: true };
          }
        }
      }
    }

    return { pyFloat, landed: false, bumped: false };
  }

  // -------------------------
  // Modes / game constants
  // -------------------------
  const MODE_MENU = "menu";
  const MODE_PLAY = "play";
  const MODE_SHOP = "shop";
  const MODE_SETTINGS = "settings";
  const MODE_DEAD = "dead";

  let mode = MODE_MENU;
  let paused = false;

  const GROUND_H = 80;
  const GROUND_Y = HEIGHT - GROUND_H;

  const JUMP_CUT_MULT = 0.55;

  const BASE_SPEED = 320.0;
  const MAX_SPEED = 820.0;
  const SPEED_RAMP = 7.0;

  const GRAVITY = 2100.0;
  const BASE_JUMP_V = 880.0;
  const MAX_FALL_V = 1500.0;

  const BASE_COYOTE = 0.10;
  const BASE_JUMP_BUF = 0.12;

  const MIN_GAP = 150;
  const MAX_GAP = 340;

  const PLATFORM_MIN_W = 160;
  const PLATFORM_MAX_W = 380;
  const PLATFORM_MIN_H = 18;
  const PLATFORM_MAX_H = 28;

  const HEIGHT_LEVELS = [0, 70, 120, 170];

  const MIN_REACTION_T = 0.60;
  const MAX_REACTION_T = 1.00;
  const MIN_HAZARD_SEP_T = 0.70;

  const HAZARD_CHANCE = 0.52;
  const COIN_CHANCE = 0.62;

  function runParamsFromUpgrades() {
    const u = SAVE.upgrades;
    return {
      jumpV: BASE_JUMP_V + 50.0 * u.jump,
      coyoteT: BASE_COYOTE + 0.02 * u.coyote,
      coinMul: 1 + 0.20 * u.coin_mult,
      magnetPx: 0 + 26 * u.magnet,
    };
  }

  // tiny “juice” state
  const JUICE = {
    playerSquash: 0,   // 0..1
    playerStretch: 0,  // 0..1
    coinPulse: 0,      // 0..1
    uiFade: 1,         // 0..1
  };

  function newRunState() {
    const { jumpV, coyoteT, coinMul, magnetPx } = runParamsFromUpgrades();
    const s = {
      cam_x: 0.0,
      speed: BASE_SPEED,
      score: 0,
      score_f: 0.0,
      coins_run: 0,
      player: rect(160, GROUND_Y - 58, 44, 58),
      py: (GROUND_Y - 58),
      vy: 0.0,
      on_ground: true,
      coyote: 0.0,
      jump_buf: 0.0,
      jump_v: jumpV,
      coyote_t: coyoteT,
      coin_mul: coinMul,
      magnet_px: magnetPx,
      platforms: [],
      hazards: [],
      coins_list: [],
      particles: [],
      shake_t: 0.0,
      shake_mag: 0.0,
      next_spawn_x: 0.0,
      last_platform_top: GROUND_Y,
      last_hazard_x: -10_000_000,
      jump_cut: false,
      jump_time: 0.0,
    };

    const starter = rect(0, GROUND_Y - 24, WIDTH + 1200, 24);
    s.platforms.push(starter);
    s.next_spawn_x = starter.x + starter.w + 140;
    s.last_platform_top = starter.y;
    return s;
  }

  let RUN = newRunState();

  function addShake(mag, t = 0.14) {
    if (!SAVE.settings.screenshake) return;
    RUN.shake_mag = Math.max(RUN.shake_mag, mag);
    RUN.shake_t = Math.max(RUN.shake_t, t);
  }

  function ensureGenerationAhead() {
    const camX = RUN.cam_x;
    while (RUN.next_spawn_x < camX + WIDTH * 2.2) spawnChunk();
  }

  function cleanupLists() {
    const camX = RUN.cam_x;
    const keep = (r) => (r.x + r.w) >= (camX - 280);
    RUN.platforms = RUN.platforms.filter(keep);
    RUN.hazards = RUN.hazards.filter(keep);
    RUN.coins_list = RUN.coins_list.filter(keep);
  }

  function spawnChunk() {
    const camX = RUN.cam_x;
    const speed = RUN.speed;
    const x = RUN.next_spawn_x;

    const w = randi(PLATFORM_MIN_W, PLATFORM_MAX_W);
    const h = randi(PLATFORM_MIN_H, PLATFORM_MAX_H);

    const prevTop = RUN.last_platform_top;

    const prevLevel = HEIGHT_LEVELS.reduce((best, lvl) => {
      const candTop = (GROUND_Y - 24) - lvl;
      const bestTop = (GROUND_Y - 24) - best;
      return Math.abs(candTop - prevTop) < Math.abs(bestTop - prevTop) ? lvl : best;
    }, HEIGHT_LEVELS[0]);

    const candidates = HEIGHT_LEVELS.slice();
    const extra = speed > 520 ? 3 : 2;
    for (let i = 0; i < extra; i++) candidates.push(prevLevel);

    const lvl = candidates[randi(0, candidates.length - 1)];
    let topY = (GROUND_Y - 24) - lvl;

    const maxStep = speed < 520 ? 170 : 125;
    if (Math.abs(topY - prevTop) > maxStep) topY = topY > prevTop ? prevTop + maxStep : prevTop - maxStep;

    const platform = rect(Math.floor(x), Math.floor(topY), Math.floor(w), Math.floor(h));
    RUN.platforms.push(platform);

    let hazChance = HAZARD_CHANCE;
    if (speed > 650) hazChance *= 0.78;

    if (Math.random() < hazChance) {
      const hzW = randi(30, 68);
      const hzH = randi(32, 62);

      const reactionPxMin = Math.floor(speed * MIN_REACTION_T);
      const reactionPxMax = Math.floor(speed * MAX_REACTION_T);

      let hx = randi(Math.floor(x - reactionPxMax), Math.floor(x - reactionPxMin));
      hx = Math.max(Math.floor(camX + WIDTH + 70), hx);

      const minSepPx = Math.floor(speed * MIN_HAZARD_SEP_T);
      if (hx - RUN.last_hazard_x < minSepPx) hx = RUN.last_hazard_x + minSepPx;
      RUN.last_hazard_x = hx;

      hx = clamp(hx, platform.x, platform.x + platform.w - hzW);
      const spikeBottom = platform.y + 2;
      RUN.hazards.push(rect(Math.floor(hx), Math.floor(spikeBottom - hzH), Math.floor(hzW), Math.floor(hzH)));
    }

    if (Math.random() < COIN_CHANCE) {
      const n = randi(3, 7);
      const baseX = platform.x + randi(20, Math.max(20, platform.w - 20));
      const baseY = platform.y - 54;
      const arc = Math.random() < 0.55;

      for (let i = 0; i < n; i++) {
        const cx = baseX + i * 34;
        const cy = arc ? baseY - Math.floor(18 * Math.sin((i / Math.max(1, n - 1)) * Math.PI)) : baseY;
        RUN.coins_list.push(rect(Math.floor(cx), Math.floor(cy), 18, 18));
      }
    }

    RUN.next_spawn_x = platform.x + platform.w + randi(MIN_GAP, MAX_GAP);
    RUN.last_platform_top = platform.y;
  }

  function resetRun() {
    RUN = newRunState();
    ensureGenerationAhead();
    JUICE.playerSquash = 0;
    JUICE.playerStretch = 0;
  }

  function awardMoneyAndSave() {
    SAVE.money += Math.floor(RUN.coins_run * RUN.coin_mul);
    SAVE.best_score = Math.max(SAVE.best_score, RUN.score);
    saveSave(SAVE);
  }

  function updateBestScore(saveNow = false) {
    SAVE.best_score = Math.max(SAVE.best_score, RUN.score);
    if (saveNow) saveSave(SAVE);
  }

  // -------------------------
  // Screens / panels
  // -------------------------
  function drawTopBar(title) {
    // top bar with slight shadow
    softShadow(true);
    ctx.fillStyle = rgb([24, 26, 36]);
    ctx.fillRect(0, 0, WIDTH, 72);
    softShadow(false);

    ctx.strokeStyle = rgb([60, 64, 80]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 72);
    ctx.lineTo(WIDTH, 72);
    ctx.stroke();

    drawText(title, 18, 16, 58, [245, 245, 250]);
    drawText(`Money: ${SAVE.money}`, WIDTH - 210, 24, 30, [245, 245, 250]);
  }

  function drawPanel(x, y, w, h) {
    softShadow(true);
    roundRectFill(x, y, w, h, 18, [26, 28, 40], [80, 86, 108], 2);
    softShadow(false);
    return rect(x, y, w, h);
  }

  // -------------------------
  // Run rendering (extra polish)
  // -------------------------
  function runDraw(shakeX, shakeY, t) {
    drawParallax(RUN.cam_x, t);

    // ground with highlight
    ctx.fillStyle = rgb(GROUND);
    ctx.fillRect(0, Math.floor(GROUND_Y + shakeY), WIDTH, GROUND_H);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(0, Math.floor(GROUND_Y + shakeY), WIDTH, 6);

    // platforms
    const platCol = getColor("platform");
    for (const p of RUN.platforms) {
      const r = copyRect(p);
      r.x = Math.floor(r.x - RUN.cam_x + shakeX);
      r.y = Math.floor(r.y + shakeY);

      softShadow(true);
      ctx.fillStyle = rgb(platCol);
      ctx.fillRect(r.x, r.y, r.w, r.h);
      softShadow(false);

      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(r.x, r.y, r.w, 3);
    }

    // spikes
    const spikeCol = getColor("spike");
    for (const h of RUN.hazards) {
      const r = copyRect(h);
      r.x = Math.floor(r.x - RUN.cam_x + shakeX);
      r.y = Math.floor(r.y + shakeY);
      spikeDraw(r, spikeCol);
    }

    // coins (sparkle + pulse)
    const pulse = 1 + 0.08 * Math.sin(t * 10);
    for (const c of RUN.coins_list) {
      const r = copyRect(c);
      r.x = Math.floor(r.x - RUN.cam_x + shakeX);
      r.y = Math.floor(r.y + shakeY);

      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      const rx = (r.w / 2) * pulse, ry = (r.h / 2) * pulse;

      // glow
      ctx.fillStyle = "rgba(255,215,90,0.18)";
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx + 6, ry + 6, 0, 0, TAU);
      ctx.fill();

      // body
      ctx.fillStyle = rgb(COIN_C);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
      ctx.fill();

      // inner ring
      ctx.strokeStyle = rgb([255, 240, 170]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(2, rx - 3), Math.max(2, ry - 3), 0, 0, TAU);
      ctx.stroke();

      // sparkle
      const sp = 0.5 + 0.5 * Math.sin(t * 6 + (c.x * 0.02));
      ctx.fillStyle = `rgba(255,255,255,${0.25 * sp})`;
      ctx.beginPath();
      ctx.arc(cx + 4, cy - 4, 2.2, 0, TAU);
      ctx.fill();
    }

    // particles (fade out by life)
    for (const p of RUN.particles) {
      const px = Math.floor(p.x - RUN.cam_x + shakeX);
      const py = Math.floor(p.y + shakeY);
      const a = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = rgba(p.col, 0.85 * a);
      ctx.beginPath();
      ctx.arc(px, py, p.r, 0, TAU);
      ctx.fill();
    }

    // player (squash/stretch)
    const pr = copyRect(RUN.player);
    pr.x = Math.floor(pr.x - RUN.cam_x + shakeX);
    pr.y = Math.floor(pr.y + shakeY);

    // apply squash/stretch around center
    const sq = 1 - 0.10 * JUICE.playerSquash;
    const st = 1 + 0.14 * JUICE.playerStretch;
    const sx = st;
    const sy = sq;

    const pc = getColor("player");
    const px = pr.x + pr.w / 2;
    const py = pr.y + pr.h / 2;

    ctx.save();
    ctx.translate(px, py);
    ctx.scale(sx, sy);
    softShadow(true);
    roundRectFill(-pr.w / 2, -pr.h / 2, pr.w, pr.h, 10, pc, null, 0);
    softShadow(false);
    ctx.restore();

    // eyes (not scaled, anchored)
    ctx.fillStyle = rgb([10, 12, 16]);
    roundRectFill(pr.x + 10, pr.y + 16, 7, 7, 3, [10, 12, 16], null, 0);
    roundRectFill(pr.x + 26, pr.y + 16, 7, 7, 3, [10, 12, 16], null, 0);

    // HUD
    drawText(`Score: ${RUN.score}`, 18, 12, 30, TEXT);
    drawText(`Coins: ${RUN.coins_run}`, 18, 42, 30, TEXT);
    drawText(`Best: ${SAVE.best_score}`, 240, 12, 30, DIM);

    if (SAVE.settings.show_fps) drawText(`FPS: ${fpsEstimate | 0}`, WIDTH - 120, 12, 24, DIM);
  }

  function pauseOverlay() {
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawText("Paused", WIDTH / 2, HEIGHT / 2 - 64, 64, [245, 245, 250], "center");
    drawText("Press P to resume | ESC to menu", WIDTH / 2, HEIGHT / 2 + 10, 30, [220, 220, 235], "center");
  }

  // -------------------------
  // Menu / Shop / Settings / Dead
  // -------------------------
  function goPlay() { resetRun(); paused = false; mode = MODE_PLAY; sfx.click(); }
  function goShop() { mode = MODE_SHOP; sfx.click(); }
  function goSettings() { mode = MODE_SETTINGS; sfx.click(); }
  function quitGame() { updateBestScore(true); running = false; sfx.click(); }

  let shopSelectedCat = "player";
  let settingsConfirmReset = false;

  // UI animation helper (fade in when changing modes)
  let lastMode = mode;
  function uiTick(dt) {
    if (mode !== lastMode) {
      JUICE.uiFade = 0;
      lastMode = mode;
    }
    JUICE.uiFade = clamp(JUICE.uiFade + dt * 3.2, 0, 1);
  }

  function menuScreen(mx, my, click, dt) {
    drawParallax(0, nowSeconds);
    const fade = smoothstep(JUICE.uiFade);

    const panel = drawPanel(90, 90, WIDTH - 180, HEIGHT - 180);
    const content = rect(panel.x + 32, panel.y + 32, panel.w - 64, panel.h - 64);

    ctx.globalAlpha = fade;
    drawText("Endless Runner", content.x, content.y, 64, [245, 245, 250]);

    const statY = content.y + 64 + 18;
    drawText(`Best Score: ${SAVE.best_score}`, content.x, statY, 30, [220, 220, 235]);
    drawText(`Money: ${SAVE.money}`, content.x, statY + 38, 30, [220, 220, 235]);

    const quitBtn = new Button(rect(content.x + content.w - 200, content.y + 6, 200, 54), "Quit", quitGame, "sub");

    const cx = content.x + content.w - 330;
    let cy = content.y + 6 + 54 + 18;

    drawText("Equipped", cx, cy, 30, [245, 245, 250]); cy += 32;
    drawText(`Player: ${SAVE.cosmetics.player}`, cx, cy, 24, [220, 220, 235]); cy += 24;
    drawText(`Platform: ${SAVE.cosmetics.platform}`, cx, cy, 24, [220, 220, 235]); cy += 24;
    drawText(`Spikes: ${SAVE.cosmetics.spike}`, cx, cy, 24, [220, 220, 235]); cy += 24;
    drawText(`Background: ${SAVE.cosmetics.background}`, cx, cy, 24, [220, 220, 235]); cy += 30;

    drawText("Upgrades", cx, cy, 30, [245, 245, 250]); cy += 32;
    for (const key of ["jump", "coyote", "coin_mult", "magnet"]) {
      drawText(`${UPGRADES[key].name}: ${SAVE.upgrades[key]}/${UPGRADES[key].max}`, cx, cy, 24, [220, 220, 235]);
      cy += 24;
    }

    const buttonW = 260, buttonH = 54, gap = 16;
    const bx = content.x;
    const desiredBy = statY + 120;
    const stackH = (buttonH * 3) + (gap * 2);
    const maxBy = content.y + content.h - stackH;
    const by = clamp(desiredBy, content.y + 160, maxBy);

    const buttons = [
      new Button(rect(bx, by, buttonW, buttonH), "Play", goPlay, "main"),
      new Button(rect(bx, by + (buttonH + gap), buttonW, buttonH), "Shop", goShop, "main"),
      new Button(rect(bx, by + 2 * (buttonH + gap), buttonW, buttonH), "Settings", goSettings, "main"),
      quitBtn
    ];

    for (const b of buttons) b.draw(mx, my, dt);
    if (click) for (const b of buttons) if (b.tryClick(mx, my)) break;

    ctx.globalAlpha = 1;

    // tiny footer hint
    drawText("Tip: Tap/Click to jump on mobile", WIDTH - 18, HEIGHT - 28, 18, DIM, "right", 0.75);
  }

  function shopScreen(mx, my, click, dt) {
    drawParallax(0, nowSeconds);
    drawTopBar("Shop");

    const panel = drawPanel(18, 90, WIDTH - 36, HEIGHT - 108);
    const leftP = rect(panel.x + 18, panel.y + 18, 420, panel.h - 36);
    const rightP = rect(leftP.x + leftP.w + 18, leftP.y, panel.w - leftP.w - 54, leftP.h);

    roundRectFill(leftP.x, leftP.y, leftP.w, leftP.h, 16, [22, 24, 34], [70, 74, 92], 2);
    roundRectFill(rightP.x, rightP.y, rightP.w, rightP.h, 16, [22, 24, 34], [70, 74, 92], 2);

    drawText("Cosmetics", leftP.x + 16, leftP.y + 14, 30, [245, 245, 250]);
    drawText("Upgrades", rightP.x + 16, rightP.y + 14, 30, [245, 245, 250]);

    const buttons = [];
    buttons.push(new Button(rect(WIDTH - 180, 80, 160, 44), "Back", () => { mode = MODE_MENU; sfx.click(); }, "sub"));

    const catTabs = ["player", "platform", "spike", "background"];
    let tabY = leftP.y + 58;
    const tabX = leftP.x + 16;

    for (const c of catTabs) {
      const label = c.charAt(0).toUpperCase() + c.slice(1);
      buttons.push(new Button(
        rect(tabX, tabY, 188, 40),
        label,
        () => { shopSelectedCat = c; sfx.click(); },
        (shopSelectedCat === c) ? "main" : "sub"
      ));
      tabY += 50;
    }

    const sel = shopSelectedCat;
    const items = Object.entries(COSMETICS[sel]).slice().sort((a, b) => a[1].price - b[1].price);

    const x = leftP.x + 16;
    drawText(`Category: ${sel.charAt(0).toUpperCase() + sel.slice(1)}`, x, leftP.y + 220, 24, [220, 220, 235]);

    let y = leftP.y + 270;
    const rowH = 44;
    const maxRows = Math.floor((leftP.y + leftP.h - (y + 10)) / rowH);
    const showItems = items.slice(0, maxRows);

    for (const [name, info] of showItems) {
      const owned = isOwned(sel, name);
      const equipped = (SAVE.cosmetics[sel] === name);
      const label2 = equipped ? "Equipped" : (owned ? "Equip" : `Buy ${info.price}`);
      const action = () => buyCosmetic(sel, name);

      buttons.push(new Button(rect(x, y, 240, 40), `${name}`, action, "sub"));
      buttons.push(new Button(rect(x + 250, y, 140, 40), label2, action, equipped ? "main" : "sub"));

      const sw = rect(x + 402, y + 8, 24, 24);
      roundRectFill(sw.x, sw.y, sw.w, sw.h, 6, info.color, [90, 96, 120], 2);
      y += rowH;
    }

    let uy = rightP.y + 58;
    const ux = rightP.x + 16;

    for (const key of ["jump", "coyote", "coin_mult", "magnet"]) {
      const lvl = SAVE.upgrades[key];
      const mxu = UPGRADES[key].max;
      const cost = (lvl < mxu) ? upgradeCost(key, lvl) : null;

      drawText(`${UPGRADES[key].name}`, ux, uy, 24, [240, 240, 245]);
      drawText(`Level: ${lvl}/${mxu}`, ux, uy + 22, 22, [200, 200, 210]);

      const label3 = (lvl >= mxu) ? "MAX" : `Buy ${cost}`;
      buttons.push(new Button(rect(rightP.x + rightP.w - 180, uy + 6, 160, 40), label3, () => buyUpgrade(key), "sub"));

      uy += 74;
    }

    for (const b of buttons) b.draw(mx, my, dt);
    if (click) for (const b of buttons) if (b.tryClick(mx, my)) break;
  }

  function settingsScreen(mx, my, click, dt) {
    drawParallax(0, nowSeconds);
    drawTopBar("Settings");

    const panel = drawPanel(18, 90, WIDTH - 36, HEIGHT - 108);
    let x = panel.x + 22;
    let y = panel.y + 42;

    const buttons = [];
    buttons.push(new Button(rect(WIDTH - 180, 80, 160, 44), "Back", () => { mode = MODE_MENU; sfx.click(); }, "sub"));

    const resetSave = () => {
      if (settingsConfirmReset) {
        settingsConfirmReset = false;
        resetSaveToDefaults();
        sfx.click();
      } else {
        settingsConfirmReset = true;
        sfx.click();
      }
    };

    buttons.push(new Button(rect(x, y, 340, 44), settingsConfirmReset ? "CONFIRM Reset Save" : "Reset Save", resetSave, "main"));

    y += 80;
    drawText("Basic", x, y, 30, [245, 245, 250]);
    y += 52;

    const toggles = [
      ["screenshake", "Screen Shake"],
      ["particles", "Particles"],
      ["show_fps", "Show FPS"],
      ["sound", "Sound"],        // NEW
      ["fullscreen", "Fullscreen"],
    ];

    for (const [key, lab] of toggles) {
      const val = SAVE.settings[key];
      buttons.push(new Button(rect(x, y, 340, 44), `${lab}: ${val ? "On" : "Off"}`, () => toggleSetting(key), "sub"));
      y += 60;
    }

    const controlsX = panel.x + panel.w / 2 + 40;
    let controlsY = panel.y + 130;

    drawText("Controls", controlsX, controlsY, 30, [245, 245, 250]);
    controlsY += 52;
    drawText("W / SPACE / TAP  Jump", controlsX, controlsY, 22, [220, 220, 235]);
    drawText("P                Pause", controlsX, controlsY + 26, 22, [220, 220, 235]);
    drawText("R                Restart run", controlsX, controlsY + 52, 22, [220, 220, 235]);
    drawText("ESC              Back/Menu", controlsX, controlsY + 78, 22, [220, 220, 235]);

    for (const b of buttons) b.draw(mx, my, dt);
    if (click) for (const b of buttons) if (b.tryClick(mx, my)) break;
  }

  function deadScreen(mx, my, click, dt) {
    drawParallax(RUN.cam_x, nowSeconds);

    const panel = drawPanel(120, 120, WIDTH - 240, HEIGHT - 240);
    let x = panel.x + 40;
    let y = panel.y + 26;

    drawText("You Died", x, y, 64, [245, 245, 250]);
    y += 92;
    drawText(`Run Score: ${RUN.score}`, x, y, 30, [235, 235, 245]); y += 38;

    const gained = Math.floor(RUN.coins_run * RUN.coin_mul);
    drawText(`Run Coins: ${RUN.coins_run}   Payout: ${gained}`, x, y, 30, [235, 235, 245]); y += 38;
    drawText(`Money: ${SAVE.money}`, x, y, 30, [235, 235, 245]); y += 38;
    drawText(`Best: ${SAVE.best_score}`, x, y, 30, DIM);

    const buttonW = 260, buttonH = 54, gap = 16;
    const bx = panel.x + panel.w - 40 - buttonW;
    const stackH = (buttonH * 3) + (gap * 2);
    const desiredBy = (panel.y + panel.h / 2) - stackH / 2;
    const by = clamp(desiredBy, panel.y + 70, panel.y + panel.h - 40 - stackH);

    const buttons = [
      new Button(rect(bx, by, buttonW, buttonH), "Play again", () => { resetRun(); paused = false; mode = MODE_PLAY; sfx.click(); }, "main"),
      new Button(rect(bx, by + buttonH + gap, buttonW, buttonH), "Shop", () => { mode = MODE_SHOP; sfx.click(); }, "sub"),
      new Button(rect(bx, by + 2 * (buttonH + gap), buttonW, buttonH), "Menu", () => { paused = false; mode = MODE_MENU; sfx.click(); }, "sub"),
    ];

    for (const b of buttons) b.draw(mx, my, dt);
    if (click) for (const b of buttons) if (b.tryClick(mx, my)) break;
  }

  // -------------------------
  // Play update/draw
  // -------------------------
  function playUpdate(dt, jumpPressed, jumpHeld, jumpReleased) {
    RUN.speed = clamp(RUN.speed + SPEED_RAMP * dt, BASE_SPEED, MAX_SPEED);
    RUN.score_f += RUN.speed * dt * 0.02;
    RUN.score = Math.floor(RUN.score_f);
    updateBestScore(false);

    if (jumpPressed) RUN.jump_buf = BASE_JUMP_BUF;
    else RUN.jump_buf = Math.max(0.0, RUN.jump_buf - dt);

    if (RUN.on_ground) {
      RUN.coyote = RUN.coyote_t;
      RUN.jump_cut = false;
    } else {
      RUN.coyote = Math.max(0.0, RUN.coyote - dt);
    }

    if (!RUN.on_ground) RUN.jump_time += dt;
    else RUN.jump_time = 0.0;

    // apply buffered jump
    if (RUN.jump_buf > 0.0 && RUN.coyote > 0.0) {
      RUN.vy = -RUN.jump_v;
      RUN.on_ground = false;
      RUN.coyote = 0.0;
      RUN.jump_buf = 0.0;
      RUN.jump_cut = false;
      RUN.jump_time = 0.0;

      JUICE.playerStretch = 1;
      sfx.jump();
    }

    RUN.vy = clamp(RUN.vy + GRAVITY * dt, -5000.0, MAX_FALL_V);

    // jump cut
    if (jumpReleased && (!RUN.on_ground) && (!RUN.jump_cut) && (RUN.vy < 0)) {
      RUN.vy *= JUMP_CUT_MULT;
      RUN.jump_cut = true;
    }

    // player x fixed relative to cam
    const player = RUN.player;
    player.x = Math.floor(RUN.cam_x + 160);

    const dy = RUN.vy * dt;
    const prevOnGround = RUN.on_ground;
    RUN.on_ground = false;

    const sweep = collideVerticalSweep(player, RUN.py, dy, RUN.platforms);
    RUN.py = sweep.pyFloat;

    // ground collision
    if (player.y + player.h >= GROUND_Y) {
      if (RUN.vy > 0) {
        player.y = GROUND_Y - player.h;
        RUN.py = player.y;
        RUN.vy = 0.0;
        RUN.on_ground = true;

        if (!prevOnGround) {
          JUICE.playerSquash = 1;
          spawnParticles(RUN.particles, centerx(player), player.y + player.h,
            10, 90, 240, 0.25, 0.55, 2.0, 4.5, [230, 230, 240], true);
        }
      }
    } else if (sweep.landed) {
      RUN.vy = 0.0;
      RUN.on_ground = true;

      if (!prevOnGround) {
        JUICE.playerSquash = 1;
        spawnParticles(RUN.particles, centerx(player), player.y + player.h,
          8, 90, 240, 0.25, 0.55, 2.0, 4.5, [230, 230, 240], true);
      }
    }

    RUN.cam_x += RUN.speed * dt;
    ensureGenerationAhead();
    cleanupLists();

    // magnet pull
    const magnetPx = RUN.magnet_px;
    if (magnetPx > 0) {
      for (const c of RUN.coins_list) {
        const dx = (centerx(player) - centerx(c));
        const dyc = (centery(player) - centery(c));
        const dist = Math.hypot(dx, dyc);
        if (0.1 < dist && dist < magnetPx) {
          const pull = (magnetPx - dist) / magnetPx;
          c.x += Math.trunc(dx * pull * dt * 2.8);
          c.y += Math.trunc(dyc * pull * dt * 2.8);
        }
      }
    }

    // coin collect
    const collected = [];
    for (let i = 0; i < RUN.coins_list.length; i++) {
      const c = RUN.coins_list[i];
      if (colliderect(player, c)) {
        collected.push(i);
        RUN.coins_run += 1;

        JUICE.coinPulse = 1;
        sfx.coin();

        spawnParticles(RUN.particles, centerx(c), centery(c),
          12, 90, 280, 0.25, 0.65, 2.0, 4.2, [255, 235, 160], false);
        addShake(2.0, 0.08);
      }
    }
    if (collected.length) {
      const dead = new Set(collected);
      RUN.coins_list = RUN.coins_list.filter((_, i) => !dead.has(i));
    }

    // hazard collide
    for (const h of RUN.hazards) {
      if (colliderect(player, h)) {
        spawnParticles(RUN.particles, centerx(player), centery(player),
          22, 180, 520, 0.35, 0.95, 2.0, 5.0, [240, 90, 90], false);
        addShake(10.0, 0.25);

        awardMoneyAndSave();
        updateBestScore(true);

        sfx.dead();
        mode = MODE_DEAD;
        return;
      }
    }

    updateParticles(RUN.particles, dt);

    // screenshake decay (more stable feel)
    if (RUN.shake_t > 0) {
      RUN.shake_t -= dt;
      if (RUN.shake_t <= 0) RUN.shake_mag = 0.0;
    } else {
      RUN.shake_mag = Math.max(0, RUN.shake_mag - dt * 12);
    }

    // juice decay
    JUICE.playerSquash = Math.max(0, JUICE.playerSquash - dt * 6);
    JUICE.playerStretch = Math.max(0, JUICE.playerStretch - dt * 7);
    JUICE.coinPulse = Math.max(0, JUICE.coinPulse - dt * 9);
  }

  function playDraw(t) {
    let shakeX = 0, shakeY = 0;
    if (RUN.shake_mag > 0.01 && RUN.shake_t > 0 && SAVE.settings.screenshake) {
      const mag = RUN.shake_mag;
      shakeX = randi(-Math.floor(mag), Math.floor(mag));
      shakeY = randi(-Math.floor(mag * 0.6), Math.floor(mag * 0.6));
    }
    runDraw(shakeX, shakeY, t);

    // coin pulse overlay (tiny “juice”)
    if (JUICE.coinPulse > 0.001) {
      const a = 0.08 * JUICE.coinPulse;
      ctx.fillStyle = `rgba(255,215,90,${a})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
  }

  // -------------------------
  // Input (mouse + touch)
  // -------------------------
  let mouseX = 0, mouseY = 0;
  let clickThisFrame = false;

  const keysDown = new Set();
  let jumpPressed = false;
  let jumpReleased = false;

  function toGameCoords(clientX, clientY) {
    return { gx: clientX - VIEW_OX, gy: clientY - VIEW_OY };
  }

  window.addEventListener("mousemove", (e) => {
    const p = toGameCoords(e.clientX, e.clientY);
    mouseX = p.gx; mouseY = p.gy;
  });

  function pointerDown(e) {
    const p = toGameCoords(e.clientX, e.clientY);
    mouseX = p.gx; mouseY = p.gy;
    clickThisFrame = true;

    // tap-to-jump while playing (if not clicking UI)
    if (mode === MODE_PLAY && !paused) {
      jumpPressed = true;
    }
  }

  window.addEventListener("mousedown", (e) => { if (e.button === 0) pointerDown(e); });

  // Touch (pointer events)
  window.addEventListener("pointerdown", (e) => {
    // avoid right-click / pen buttons weirdness
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pointerDown(e);
  }, { passive: true });

  window.addEventListener("keydown", (e) => {
    keysDown.add(e.code);

    if (e.code === "KeyW" || e.code === "Space") jumpPressed = true;

    if (e.code === "KeyP" && mode === MODE_PLAY) { paused = !paused; sfx.click(); }

    if (e.code === "KeyR" && mode === MODE_PLAY) { resetRun(); paused = false; sfx.click(); }

    if (e.code === "Escape") {
      updateBestScore(true);
      if (mode === MODE_PLAY) { paused = false; mode = MODE_MENU; }
      else if (mode === MODE_SHOP || mode === MODE_SETTINGS || mode === MODE_DEAD) mode = MODE_MENU;
      else running = false;

      if (SAVE.settings.fullscreen) setFullscreen(false);
      sfx.click();
    }
  });

  window.addEventListener("keyup", (e) => {
    keysDown.delete(e.code);
    if ((e.code === "KeyW" || e.code === "Space") && mode === MODE_PLAY) jumpReleased = true;
  });

  function isJumpHeld() {
    return keysDown.has("KeyW") || keysDown.has("Space");
  }

  // -------------------------
  // Main loop + letterbox render
  // -------------------------
  resetRun();
  ensureGenerationAhead();

  let running = true;
  let lastTS = performance.now();
  let tAccum = 0.0;

  let fpsEstimate = 60;
  const fpsSmoothing = 0.08;

  let nowSeconds = 0;

  function frame(ts) {
    if (!running) return;

    const dt = clamp((ts - lastTS) / 1000.0, 0, 0.05);
    lastTS = ts;
    tAccum += dt;
    nowSeconds = ts / 1000.0;

    // fps estimate
    const instFps = dt > 0 ? 1 / dt : 60;
    fpsEstimate = fpsEstimate + (instFps - fpsEstimate) * fpsSmoothing;

    uiTick(dt);

    // edge flags
    const localClick = clickThisFrame;
    clickThisFrame = false;

    const localJumpPressed = jumpPressed;
    const localJumpReleased = jumpReleased;
    jumpPressed = false;
    jumpReleased = false;

    // Clear whole window
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = "black";
    ctx.fillRect(0, 0, WIN_W, WIN_H);

    // Draw into letterboxed region
    ctx.save();
    ctx.translate(VIEW_OX, VIEW_OY);
    ctx.beginPath();
    ctx.rect(0, 0, WIDTH, HEIGHT);
    ctx.clip();

    const mx = mouseX, my = mouseY;

    if (mode === MODE_MENU) {
      menuScreen(mx, my, localClick, dt);
    } else if (mode === MODE_SHOP) {
      shopScreen(mx, my, localClick, dt);
    } else if (mode === MODE_SETTINGS) {
      settingsScreen(mx, my, localClick, dt);
    } else if (mode === MODE_DEAD) {
      deadScreen(mx, my, localClick, dt);
    } else if (mode === MODE_PLAY) {
      if (!paused) playUpdate(dt, localJumpPressed, isJumpHeld(), localJumpReleased);
      playDraw(tAccum);
      if (paused) pauseOverlay();
    }

    ctx.restore();

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();

