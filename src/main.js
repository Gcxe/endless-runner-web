import Phaser from "phaser";

const GAME_W = 960;
const GAME_H = 540;

const GROUND_H = 80;
const GROUND_Y = GAME_H - GROUND_H;

const BASE_SPEED = 320;
const MAX_SPEED = 820;
const SPEED_RAMP = 7;

const GRAVITY = 2100;
const BASE_JUMP_V = 920;     // stronger jump to match your “feel”
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

const JUMP_CUT_MULT = 0.55;

const SAVE_KEY = "runner_save_v2";

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

function loadSave() {
  const def = { best: 0, money: 0 };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

function saveSave(data) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {}
}

/**
 * One-way platform rule (Arcade Physics):
 * Only collide if player is moving down AND the player was above the platform top last frame.
 * This removes “edge teleport under platform” behaviour and feels like your Pygame sweep.
 */
function oneWayProcess(player, platform) {
  const body = player.body;
  const pBody = platform.body;

  // Only when falling (or basically not rising)
  if (body.velocity.y < 0) return false;

  // Previous bottom vs platform top
  // Arcade gives prev values on body.prev
  const prevBottom = body.prev.y + body.height;
  const platTop = pBody.y; // static body y is top-left

  // Small tolerance to handle rounding at edges
  return prevBottom <= platTop + 3;
}

class RunnerScene extends Phaser.Scene {
  constructor() {
    super("runner");
  }

  init() {
    this.save = loadSave();
    this.mode = "menu"; // menu | play | dead
    this.paused = false;

    this.camX = 0;
    this.speed = BASE_SPEED;

    this.scoreF = 0;
    this.score = 0;
    this.coinsRun = 0;

    this.jumpBuf = 0;
    this.coyote = BASE_COYOTE;
    this.jumpCut = false;

    this.lastPlatformTop = GROUND_Y;
    this.lastHazardX = -1e9;
    this.nextSpawnX = 0;

    this.magnetPx = 0; // hook for later upgrades
    this.saveDirtyTimer = 0; // avoid writing localStorage every frame
  }

  create() {
    this.cameras.main.setBackgroundColor("#101218");

    this.keyW = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keySpace = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyP = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.P);
    this.keyR = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.keyEsc = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ESC);

    this.physics.world.setBounds(0, 0, 1000000, GAME_H);

    this.platforms = this.physics.add.staticGroup();
    this.spikes = this.physics.add.staticGroup();
    this.coins = this.physics.add.group({ allowGravity: false, immovable: true });

    // Player as a rectangle with Arcade body
    this.player = this.add.rectangle(160, GROUND_Y - 29, 44, 58, 0x78c8ff);
    this.physics.add.existing(this.player);
    this.player.body.setGravityY(GRAVITY);
    this.player.body.setMaxVelocity(9999, MAX_FALL_V);
    this.player.body.setCollideWorldBounds(false);

    // One-way platform collider
    this.platformCollider = this.physics.add.collider(
      this.player,
      this.platforms,
      () => {
        // landing
        this.coyote = BASE_COYOTE;
        this.jumpCut = false;
      },
      oneWayProcess,
      this
    );

    this.physics.add.overlap(this.player, this.spikes, () => this.die(), null, this);
    this.physics.add.overlap(this.player, this.coins, (_, coin) => {
      coin.destroy();
      this.coinsRun += 1;
    });

    this.ui = {
      title: this.add.text(24, 18, "Endless Runner", {
        fontFamily: "sans-serif",
        fontSize: "46px",
        color: "#f5f5fa",
      }).setScrollFactor(0),

      hint: this.add.text(24, 78, "Press W / SPACE to play", {
        fontFamily: "sans-serif",
        fontSize: "20px",
        color: "#d8d8ea",
      }).setScrollFactor(0),

      menuStats: this.add.text(24, 110, "", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        color: "#c8c8d2",
      }).setScrollFactor(0),

      hudScore: this.add.text(18, 12, "", {
        fontFamily: "sans-serif",
        fontSize: "20px",
        color: "#f0f0f5",
      }).setScrollFactor(0).setVisible(false),

      hudCoins: this.add.text(18, 40, "", {
        fontFamily: "sans-serif",
        fontSize: "20px",
        color: "#f0f0f5",
      }).setScrollFactor(0).setVisible(false),

      hudBest: this.add.text(240, 12, "", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        color: "#c8c8d2",
      }).setScrollFactor(0).setVisible(false),

      dead: this.add.text(GAME_W / 2, GAME_H / 2 - 40, "", {
        fontFamily: "sans-serif",
        fontSize: "42px",
        color: "#f5f5fa",
        align: "center",
      }).setOrigin(0.5).setScrollFactor(0).setVisible(false),

      deadHint: this.add.text(GAME_W / 2, GAME_H / 2 + 40, "Press R to restart | ESC for menu", {
        fontFamily: "sans-serif",
        fontSize: "18px",
        color: "#d8d8ea",
      }).setOrigin(0.5).setScrollFactor(0).setVisible(false),
    };

    this.resetRun();
    this.toMenu();
  }

  toMenu() {
    this.mode = "menu";
    this.paused = false;

    this.ui.title.setVisible(true);
    this.ui.hint.setVisible(true);
    this.ui.menuStats.setVisible(true);

    this.ui.hudScore.setVisible(false);
    this.ui.hudCoins.setVisible(false);
    this.ui.hudBest.setVisible(false);

    this.ui.dead.setVisible(false);
    this.ui.deadHint.setVisible(false);

    this.ui.menuStats.setText(`Best: ${this.save.best}\nMoney: ${this.save.money}\n\nW/SPACE jump\nP pause | R restart | ESC menu`);
  }

  toPlay() {
    this.mode = "play";
    this.paused = false;

    this.ui.title.setVisible(false);
    this.ui.hint.setVisible(false);
    this.ui.menuStats.setVisible(false);

    this.ui.hudScore.setVisible(true);
    this.ui.hudCoins.setVisible(true);
    this.ui.hudBest.setVisible(true);

    this.ui.dead.setVisible(false);
    this.ui.deadHint.setVisible(false);
  }

  resetRun() {
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
    this.jumpCut = false;

    // Starter platform
    const starterW = GAME_W + 1200;
    const starterH = 24;
    const starterX = starterW / 2;
    const starterY = (GROUND_Y - starterH / 2);

    const starter = this.add.rectangle(starterX, starterY, starterW, starterH, 0xd2d2dc);
    this.physics.add.existing(starter, true);
    starter.body.setSize(starterW, starterH);
    this.platforms.add(starter);

    this.lastPlatformTop = starter.body.y;
    this.lastHazardX = -1e9;
    this.nextSpawnX = starterX + starterW / 2 + 140;

    // Player reset
    this.player.x = 160;
    this.player.y = GROUND_Y - 29;
    this.player.body.reset(this.player.x, this.player.y);
    this.player.body.setVelocity(0, 0);

    this.ensureGenerationAhead();
  }

  die() {
    if (this.mode !== "play") return;

    this.save.money += this.coinsRun;
    this.save.best = Math.max(this.save.best, this.score);
    saveSave(this.save);

    this.mode = "dead";
    this.paused = false;

    this.ui.dead.setText(`You Died\nScore: ${this.score}\nCoins: ${this.coinsRun}`).setVisible(true);
    this.ui.deadHint.setVisible(true);

    this.ui.hudScore.setVisible(false);
    this.ui.hudCoins.setVisible(false);
    this.ui.hudBest.setVisible(false);
  }

  ensureGenerationAhead() {
    while (this.nextSpawnX < this.camX + GAME_W * 2.2) {
      this.spawnChunk();
    }
  }

  cleanup() {
    const minX = this.camX - 320;

    const prune = (group) => {
      group.getChildren().forEach((obj) => {
        const w = obj.width ?? obj.body?.width ?? 0;
        if (obj.x + w / 2 < minX) obj.destroy();
      });
    };

    prune(this.platforms);
    prune(this.spikes);

    this.coins.getChildren().forEach((coin) => {
      if (coin.x + 12 < minX) coin.destroy();
    });
  }

  spawnChunk() {
    const speed = this.speed;
    const x = this.nextSpawnX;

    const w = Phaser.Math.Between(PLATFORM_MIN_W, PLATFORM_MAX_W);
    const h = Phaser.Math.Between(PLATFORM_MIN_H, PLATFORM_MAX_H);

    const prevTop = this.lastPlatformTop;
    const groundTop = GROUND_Y - 24;

    // Find closest level to previous
    let prevLevel = HEIGHT_LEVELS[0];
    {
      let bestDist = Infinity;
      for (const lvl of HEIGHT_LEVELS) {
        const top = groundTop - lvl;
        const d = Math.abs(top - prevTop);
        if (d < bestDist) {
          bestDist = d;
          prevLevel = lvl;
        }
      }
    }

    const candidates = [...HEIGHT_LEVELS];
    const biasCount = speed > 520 ? 3 : 2;
    for (let i = 0; i < biasCount; i++) candidates.push(prevLevel);

    const lvl = candidates[Phaser.Math.Between(0, candidates.length - 1)];
    let top = groundTop - lvl;

    const maxStep = speed < 520 ? 170 : 125;
    if (Math.abs(top - prevTop) > maxStep) {
      top = top > prevTop ? prevTop + maxStep : prevTop - maxStep;
    }

    const platX = x + w / 2;
    const platY = top + h / 2;

    const platform = this.add.rectangle(platX, platY, w, h, 0xd2d2dc);
    this.physics.add.existing(platform, true);
    platform.body.setSize(w, h);
    this.platforms.add(platform);

    // Spikes sit on top of this platform (like your fixed Python)
    let hazChance = HAZARD_CHANCE;
    if (speed > 650) hazChance *= 0.78;

    if (Math.random() < hazChance) {
      const hzW = Phaser.Math.Between(30, 68);
      const hzH = Phaser.Math.Between(32, 62);

      let hx = Phaser.Math.Between(Math.floor(platX - w / 2), Math.floor(platX + w / 2 - hzW));
      const minSepPx = speed * 0.70;
      if (hx - this.lastHazardX < minSepPx) hx = this.lastHazardX + minSepPx;
      this.lastHazardX = hx;

      hx = clamp(hx, platX - w / 2, platX + w / 2 - hzW);

      const spikeBottom = top + 2;
      const spikeX = hx + hzW / 2;
      const spikeY = spikeBottom - hzH / 2;

      const spike = this.add.rectangle(spikeX, spikeY, hzW, hzH, 0xff5a5a);
      this.physics.add.existing(spike, true);
      spike.body.setSize(hzW, hzH);
      this.spikes.add(spike);
    }

    // Coins
    if (Math.random() < COIN_CHANCE) {
      const n = Phaser.Math.Between(3, 7);
      const baseX = (platX - w / 2) + Phaser.Math.Between(20, Math.max(20, w - 20));
      const baseY = top - 54;
      const arc = Math.random() < 0.55;

      for (let i = 0; i < n; i++) {
        const cx = baseX + i * 34;
        const cy = arc ? baseY - Math.floor(18 * Math.sin((i / Math.max(1, n - 1)) * Math.PI)) : baseY;
        const coin = this.add.ellipse(cx, cy, 18, 18, 0xffd75a);
        this.physics.add.existing(coin);
        coin.body.setAllowGravity(false);
        coin.body.setImmovable(true);
        coin.body.setCircle(9);
        this.coins.add(coin);
      }
    }

    const gap = Phaser.Math.Between(MIN_GAP, MAX_GAP);
    this.nextSpawnX = x + w + gap;
    this.lastPlatformTop = platform.body.y;
  }

  update(_, delta) {
    const dt = delta / 1000;

    const jumpDown = Phaser.Input.Keyboard.JustDown(this.keyW) || Phaser.Input.Keyboard.JustDown(this.keySpace);
    const jumpUp = Phaser.Input.Keyboard.JustUp(this.keyW) || Phaser.Input.Keyboard.JustUp(this.keySpace);
    const jumpHeld = this.keyW.isDown || this.keySpace.isDown;

    if (this.mode === "menu") {
      if (jumpDown) {
        this.resetRun();
        this.toPlay();
      }
      return;
    }

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

    // Speed + score (Python-style)
    this.speed = clamp(this.speed + SPEED_RAMP * dt, BASE_SPEED, MAX_SPEED);
    this.scoreF += this.speed * dt * 0.02;
    this.score = Math.floor(this.scoreF);

    // Save best occasionally (not every frame)
    this.save.best = Math.max(this.save.best, this.score);
    this.saveDirtyTimer += dt;
    if (this.saveDirtyTimer > 1.0) {
      saveSave(this.save);
      this.saveDirtyTimer = 0;
    }

    // Jump buffer
    if (jumpDown) this.jumpBuf = BASE_JUMP_BUF;
    else this.jumpBuf = Math.max(0, this.jumpBuf - dt);

    // Coyote time: based on whether we are grounded
    const body = this.player.body;
    const grounded = body.blocked.down || body.touching.down;

    if (grounded) this.coyote = BASE_COYOTE;
    else this.coyote = Math.max(0, this.coyote - dt);

    // Jump execute
    if (this.jumpBuf > 0 && this.coyote > 0) {
      body.setVelocityY(-BASE_JUMP_V);
      this.jumpBuf = 0;
      this.coyote = 0;
      this.jumpCut = false;
    }

    // Variable height: release early cuts upward velocity
    if (jumpUp && !this.jumpCut && body.velocity.y < 0) {
      body.setVelocityY(body.velocity.y * JUMP_CUT_MULT);
      this.jumpCut = true;
    }

    // Secondary “short hop” behaviour: if player stops holding quickly, cut once early
    if (!jumpHeld && !this.jumpCut && body.velocity.y < 0 && body.velocity.y < -60) {
      // This is mild and keeps tap jumps consistent without feeling floaty.
      // If you dislike it, delete this block.
      body.setVelocityY(body.velocity.y * 0.98);
    }

    // Runner camera
    this.camX += this.speed * dt;
    this.player.x = this.camX + 160;
    this.cameras.main.scrollX = this.camX;

    // Ground plane as a hard stop (matches your Python clamp)
    if (this.player.y + 58 / 2 >= GROUND_Y) {
      this.player.y = GROUND_Y - 58 / 2;
      body.setVelocityY(0);
    }

    // Optional magnet
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

    this.ensureGenerationAhead();
    this.cleanup();

    this.ui.hudScore.setText(`Score: ${this.score}`);
    this.ui.hudCoins.setText(`Coins: ${this.coinsRun}`);
    this.ui.hudBest.setText(`Best: ${this.save.best}`);

    if (this.player.y > GAME_H + 220) this.die();
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: GAME_W,
  height: GAME_H,
  physics: {
    default: "arcade",
    arcade: { gravity: { y: 0 }, debug: false },
  },
  scene: [RunnerScene],
});
