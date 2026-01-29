import Phaser from "phaser";

/*
Core design notes (kept short on purpose):
- Variable jump height: press = jump; release early = cut upward velocity -> small jump.
- Coyote time + jump buffer implemented similarly to your Python version.
- Spikes spawn ON platforms, and collisions use Arcade Physics bodies (no "teleport under platform" edge bug).
*/

const GAME_W = 960;
const GAME_H = 540;

const GROUND_H = 80;
const GROUND_Y = GAME_H - GROUND_H;

const BASE_SPEED = 320;
const MAX_SPEED = 820;
const SPEED_RAMP = 7;

const GRAVITY = 2100;
const BASE_JUMP_V = 900; // stronger than your 780
const MAX_FALL_V = 1500;

const BASE_COYOTE = 0.10;
const BASE_JUMP_BUF = 0.12;

const MIN_GAP = 150;
const MAX_GAP = 340;

const PLATFORM_MIN_W = 160;
const PLATFORM_MAX_W = 380;
const PLATFORM_MIN_H = 18;
const PLATFORM_MAX_H = 28;

const HEIGHT_LEVELS = [0, 70, 120, 170];

const HAZARD_CHANCE = 0.52;
const COIN_CHANCE = 0.62;

const JUMP_CUT_MULT = 0.55; // lower = smaller tap jumps

const SAVE_KEY = "runner_save_v1";

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function loadSave() {
  const def = { best: 0, money: 0 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return def;
    const parsed = JSON.parse(raw);
    return { ...def, ...parsed };
  } catch {
    return def;
  }
}

function saveSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {}
}

class RunnerScene extends Phaser.Scene {
  constructor() {
    super("runner");
  }

  init() {
    this.save = loadSave();
    this.mode = "menu"; // "menu" | "play" | "dead"
    this.paused = false;

    this.camX = 0;
    this.speed = BASE_SPEED;

    this.scoreF = 0;
    this.score = 0;
    this.coinsRun = 0;

    this.jumpBuf = 0;
    this.coyote = 0;
    this.onGround = true;

    this.jumpCut = false;

    this.magnetPx = 0; // easy hook for later upgrades (e.g. 120)
  }

  preload() {}

  create() {
    this.cameras.main.setBackgroundColor("#101218");

    // Input
    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    // World bounds: large horizontal, vertical fixed
    this.physics.world.setBounds(0, 0, 1000000, GAME_H);

    // Groups
    this.platforms = this.physics.add.staticGroup();
    this.spikes = this.physics.add.staticGroup();
    this.coins = this.physics.add.group({ allowGravity: false, immovable: true });

    // Starter platform (a long strip)
    this.nextSpawnX = 0;

    // Player
    this.player = this.add.rectangle(160, GROUND_Y - 29, 44, 58, 0x78c8ff);
    this.physics.add.existing(this.player);
    this.player.body.setCollideWorldBounds(false);
    this.player.body.setGravityY(GRAVITY);
    this.player.body.setMaxVelocity(9999, MAX_FALL_V);

    // Collisions
    this.physics.add.collider(this.player, this.platforms, () => {
      this.onGround = true;
      this.coyote = BASE_COYOTE;
      this.jumpCut = false;
    });

    this.physics.add.overlap(this.player, this.spikes, () => this.die(), null, this);
    this.physics.add.overlap(this.player, this.coins, (player, coin) => {
      coin.destroy();
      this.coinsRun += 1;
    });

    // UI
    this.ui = {
      title: this.add.text(24, 18, "Endless Runner", { fontFamily: "sans-serif", fontSize: "46px", color: "#f5f5fa" }).setScrollFactor(0),
      hint: this.add.text(24, 78, "Press W / SPACE to play", { fontFamily: "sans-serif", fontSize: "20px", color: "#d8d8ea" }).setScrollFactor(0),
      stats: this.add.text(24, 110, "", { fontFamily: "sans-serif", fontSize: "18px", color: "#c8c8d2" }).setScrollFactor(0),

      hud: this.add.text(18, 12, "", { fontFamily: "sans-serif", fontSize: "20px", color: "#f0f0f5" }).setScrollFactor(0).setVisible(false),
      hud2: this.add.text(18, 40, "", { fontFamily: "sans-serif", fontSize: "20px", color: "#f0f0f5" }).setScrollFactor(0).setVisible(false),
      hud3: this.add.text(240, 12, "", { fontFamily: "sans-serif", fontSize: "18px", color: "#c8c8d2" }).setScrollFactor(0).setVisible(false),

      dead: this.add.text(GAME_W / 2, GAME_H / 2 - 40, "", { fontFamily: "sans-serif", fontSize: "42px", color: "#f5f5fa" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setVisible(false),

      deadHint: this.add.text(GAME_W / 2, GAME_H / 2 + 20, "Press R to restart | ESC for menu", { fontFamily: "sans-serif", fontSize: "18px", color: "#d8d8ea" })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setVisible(false),
    };

    this.resetRun();
    this.toMenu();
  }

  resetRun() {
    // Clear old objects
    this.platforms.clear(true, true);
    this.spikes.clear(true, true);
    this.coins.clear(true, true);

    this.camX = 0;
    this.speed = BASE_SPEED;

    this.scoreF = 0;
    this.score = 0;
    this.coinsRun = 0;

    this.jumpBuf = 0;
    this.coyote = BASE_COYOTE;
    this.onGround = true;
    this.jumpCut = false;

    // Starter platform
    const starter = this.add.rectangle(GAME_W / 2, GROUND_Y - 12, GAME_W + 1200, 24, 0xd2d2dc);
    this.physics.add.existing(starter, true);
    this.platforms.add(starter);

    this.lastPlatformTop = starter.y - starter.height / 2;
    this.lastHazardX = -1e9;

    // Put player above starter
    this.player.x = 160;
    this.player.y = GROUND_Y - 29;
    this.player.body.setVelocity(0, 0);

    this.nextSpawnX = starter.x + starter.width / 2 + 140;

    this.ensureGenerationAhead();
  }

  toMenu() {
    this.mode = "menu";
    this.paused = false;

    this.ui.title.setVisible(true);
    this.ui.hint.setVisible(true);
    this.ui.stats.setVisible(true);

    this.ui.hud.setVisible(false);
    this.ui.hud2.setVisible(false);
    this.ui.hud3.setVisible(false);

    this.ui.dead.setVisible(false);
    this.ui.deadHint.setVisible(false);

    this.ui.stats.setText(
      `Best: ${this.save.best}\nMoney: ${this.save.money}\n\nOnline build (Phaser + Vite)\nNo shop yet: extendable`
    );
  }

  toPlay() {
    this.mode = "play";
    this.paused = false;

    this.ui.title.setVisible(false);
    this.ui.hint.setVisible(false);
    this.ui.stats.setVisible(false);

    this.ui.hud.setVisible(true);
    this.ui.hud2.setVisible(true);
    this.ui.hud3.setVisible(true);

    this.ui.dead.setVisible(false);
    this.ui.deadHint.setVisible(false);
  }

  die() {
    if (this.mode !== "play") return;

    // Payout: keep simple (coins become money). Easy to adjust later.
    this.save.money += this.coinsRun;
    this.save.best = Math.max(this.save.best, this.score);
    saveSave(this.save);

    this.mode = "dead";
    this.paused = false;

    this.ui.dead.setText(`You Died\nScore: ${this.score}\nCoins: ${this.coinsRun}`).setVisible(true);
    this.ui.deadHint.setVisible(true);

    this.ui.hud.setVisible(false);
    this.ui.hud2.setVisible(false);
    this.ui.hud3.setVisible(false);
  }

  ensureGenerationAhead() {
    while (this.nextSpawnX < this.camX + GAME_W * 2.2) {
      this.spawnChunk();
    }
  }

  cleanup() {
    const minX = this.camX - 280;

    const pruneStaticGroup = (group) => {
      group.getChildren().forEach((obj) => {
        if (obj.x + obj.width / 2 < minX) obj.destroy();
      });
    };

    pruneStaticGroup(this.platforms);
    pruneStaticGroup(this.spikes);

    this.coins.getChildren().forEach((coin) => {
      if (coin.x + coin.width / 2 < minX) coin.destroy();
    });
  }

  spawnChunk() {
    const speed = this.speed;
    const x = this.nextSpawnX;

    const w = Phaser.Math.Between(PLATFORM_MIN_W, PLATFORM_MAX_W);
    const h = Phaser.Math.Between(PLATFORM_MIN_H, PLATFORM_MAX_H);

    const prevTop = this.lastPlatformTop;

    // Pick a target height level, biased toward previous
    const groundTop = GROUND_Y - 24;
    const prevLevel = HEIGHT_LEVELS.reduce((best, lvl) => {
      const top = groundTop - lvl;
      return Math.abs(top - prevTop) < Math.abs((groundTop - best) - prevTop) ? lvl : best;
    }, HEIGHT_LEVELS[0]);

    const candidates = [...HEIGHT_LEVELS];
    const biasCount = speed > 520 ? 3 : 2;
    for (let i = 0; i < biasCount; i++) candidates.push(prevLevel);

    const lvl = candidates[Phaser.Math.Between(0, candidates.length - 1)];
    let top = groundTop - lvl;

    const maxStep = speed < 520 ? 170 : 125;
    if (Math.abs(top - prevTop) > maxStep) {
      top = top > prevTop ? prevTop + maxStep : prevTop - maxStep;
    }

    // Platform rectangle (Phaser uses center coords for rectangle)
    const platX = x + w / 2;
    const platY = top + h / 2;
    const platform = this.add.rectangle(platX, platY, w, h, 0xd2d2dc);
    this.physics.add.existing(platform, true);
    this.platforms.add(platform);

    // Hazards
    let hazChance = HAZARD_CHANCE;
    if (speed > 650) hazChance *= 0.78;

    if (Math.random() < hazChance) {
      const hzW = Phaser.Math.Between(30, 68);
      const hzH = Phaser.Math.Between(32, 62);

      // place hazard somewhere on this platform, but not too close to previous hazard
      let hx = Phaser.Math.Between(platform.x - platform.width / 2, platform.x + platform.width / 2 - hzW);
      const minSepPx = speed * 0.70;
      if (hx - this.lastHazardX < minSepPx) hx = this.lastHazardX + minSepPx;
      this.lastHazardX = hx;

      hx = clamp(hx, platform.x - platform.width / 2, platform.x + platform.width / 2 - hzW);

      const spikeBottom = top + 2;
      const spike = this.add.rectangle(hx + hzW / 2, spikeBottom - hzH / 2, hzW, hzH, 0xff5a5a);
      this.physics.add.existing(spike, true);
      this.spikes.add(spike);
    }

    // Coins (simple row/arc)
    if (Math.random() < COIN_CHANCE) {
      const n = Phaser.Math.Between(3, 7);
      const baseX = (platform.x - platform.width / 2) + Phaser.Math.Between(20, Math.max(20, platform.width - 20));
      const baseY = top - 54;
      const arc = Math.random() < 0.55;

      for (let i = 0; i < n; i++) {
        const cx = baseX + i * 34;
        const cy = arc ? baseY - Math.floor(18 * Math.sin((i / Math.max(1, n - 1)) * Math.PI)) : baseY;
        const coin = this.add.ellipse(cx, cy, 18, 18, 0xffd75a);
        this.physics.add.existing(coin);
        coin.body.setAllowGravity(false);
        coin.body.setImmovable(true);
        this.coins.add(coin);
      }
    }

    const gap = Phaser.Math.Between(MIN_GAP, MAX_GAP);
    this.nextSpawnX = x + w + gap;
    this.lastPlatformTop = top;
  }

  update(time, delta) {
    const dt = delta / 1000;

    // Menu controls
    const jumpDown = Phaser.Input.Keyboard.JustDown(this.keyW) || Phaser.Input.Keyboard.JustDown(this.keySpace);
    if (this.mode === "menu") {
      if (jumpDown) {
        this.resetRun();
        this.toPlay();
      }
      return;
    }

    // Dead controls
    if (this.mode === "dead") {
      if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
        this.resetRun();
        this.toPlay();
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
        this.resetRun();
        this.toMenu();
      }
      return;
    }

    // Play controls
    if (Phaser.Input.Keyboard.JustDown(this.keyP)) this.paused = !this.paused;
    if (Phaser.Input.Keyboard.JustDown(this.keyR)) {
      this.resetRun();
      this.toPlay();
      return;
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyEsc)) {
      this.save.best = Math.max(this.save.best, this.score);
      saveSave(this.save);
      this.resetRun();
      this.toMenu();
      return;
    }

    if (this.paused) return;

    const jumpHeld = this.keyW.isDown || this.keySpace.isDown;
    const jumpReleased = Phaser.Input.Keyboard.JustUp(this.keyW) || Phaser.Input.Keyboard.JustUp(this.keySpace);

    // Speed + score
    this.speed = clamp(this.speed + SPEED_RAMP * dt, BASE_SPEED, MAX_SPEED);
    this.scoreF += this.speed * dt * 0.02;
    this.score = Math.floor(this.scoreF);
    this.save.best = Math.max(this.save.best, this.score);
    saveSave(this.save);

    // Jump buffer
    if (jumpDown) {
      this.jumpBuf = BASE_JUMP_BUF;
    } else {
      this.jumpBuf = Math.max(0, this.jumpBuf - dt);
    }

    // On-ground detection via body touching + our collision callback
    // If we leave ground, coyote ticks down
    const body = this.player.body;
    const touchingDown = body.blocked.down || body.touching.down;

    if (touchingDown) {
      this.onGround = true;
      this.coyote = BASE_COYOTE;
      this.jumpCut = false;
    } else {
      this.onGround = false;
      this.coyote = Math.max(0, this.coyote - dt);
    }

    // Execute jump when buffered and allowed
    if (this.jumpBuf > 0 && this.coyote > 0) {
      body.setVelocityY(-BASE_JUMP_V);
      this.jumpBuf = 0;
      this.coyote = 0;
      this.jumpCut = false;
    }

    // Variable jump height: release early cuts upward velocity
    if (jumpReleased && !this.jumpCut && body.velocity.y < 0) {
      body.setVelocityY(body.velocity.y * JUMP_CUT_MULT);
      this.jumpCut = true;
    }

    // Prevent absurd upward speeds
    if (body.velocity.y < -5000) body.setVelocityY(-5000);

    // Force player x to follow camera (runner style)
    this.camX += this.speed * dt;
    this.player.x = this.camX + 160;

    // "Ground" clamp (in case no platform)
    if (this.player.y + 58 / 2 > GROUND_Y) {
      this.player.y = GROUND_Y - 58 / 2;
      body.setVelocityY(0);
    }

    // Magnet (optional)
    if (this.magnetPx > 0) {
      this.coins.getChildren().forEach((coin) => {
        const dx = this.player.x - coin.x;
        const dy = this.player.y - coin.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.1 && dist < this.magnetPx) {
          const pull = (this.magnetPx - dist) / this.magnetPx;
          coin.x += dx * pull * dt * 2.8;
          coin.y += dy * pull * dt * 2.8;
          coin.body.reset(coin.x, coin.y);
        }
      });
    }

    // Camera follow
    this.cameras.main.scrollX = this.camX;

    // Generate + cleanup
    this.ensureGenerationAhead();
    this.cleanup();

    // HUD
    this.ui.hud.setText(`Score: ${this.score}`);
    this.ui.hud2.setText(`Coins: ${this.coinsRun}`);
    this.ui.hud3.setText(`Best: ${this.save.best}`);

    // Death if you fall far below
    if (this.player.y > GAME_H + 200) this.die();
  }
}

const config = {
  type: Phaser.AUTO,
  parent: "app",
  width: GAME_W,
  height: GAME_H,
  physics: {
    default: "arcade",
    arcade: {
      gravity: { y: 0 }, // player has its own gravity
      debug: false
    }
  },
  scene: [RunnerScene]
};

new Phaser.Game(config);
