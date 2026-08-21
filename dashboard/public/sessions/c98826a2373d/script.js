/* Snake — tickets 1-3: playable game, start menu + score system,
 * neon / geometric visual polish.
 *
 * Structure:
 *   - Config:     tunables (tick rate, min/max cell size, UI chrome budget).
 *   - SnakeGame:  pure game logic (board, snake, food, score, collisions).
 *   - Renderer:   neon canvas drawing (glow, gradient snake, pulsing food).
 *   - Controller (bottom): start menu, ready overlay, input, high score,
 *     and the fixed-timestep game loop.
 */

"use strict";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TICK_MS = 150;            // one cell per tick
const MIN_CELL_PX = 12;         // cells never render smaller than this
const MAX_CELL_PX = 32;         // ...and not larger than this (cosmetic)
const UI_CHROME_PX = 150;       // HUD + footer + padding + borders reserved
                                // around the board in the smaller viewport
                                // dimension (spec section 3)
const MIN_BOARD_SIZE = 10;
const MAX_BOARD_SIZE = 99;
const DEFAULT_BOARD_SIZE = 20;

const KEY_DIRECTIONS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

// ---------------------------------------------------------------------------
// SnakeGame: pure game logic, no DOM/canvas access
// ---------------------------------------------------------------------------

class SnakeGame {
  constructor(boardSize) {
    this.boardSize = boardSize;
    this.reset();
  }

  // Reset to initial state: length-3 snake at center, heading right.
  reset() {
    const c = Math.floor(this.boardSize / 2);
    // snake[0] is the head; body trails behind the direction of travel.
    this.snake = [
      { x: c, y: c },
      { x: c - 1, y: c },
      { x: c - 2, y: c },
    ];
    this.direction = { x: 1, y: 0 };
    this.pendingDirection = { x: 1, y: 0 };
    this.score = 0;
    this.alive = true;
    this.food = this.spawnFood();
  }

  // Pick a random cell that is not occupied by the snake.
  spawnFood() {
    const free = [];
    for (let y = 0; y < this.boardSize; y++) {
      for (let x = 0; x < this.boardSize; x++) {
        const occupied = this.snake.some((s) => s.x === x && s.y === y);
        if (!occupied) free.push({ x, y });
      }
    }
    if (free.length === 0) return null; // board full: snake wins
    return free[Math.floor(Math.random() * free.length)];
  }

  // Queue a direction change; reversing into the neck is ignored.
  setDirection(dir) {
    if (!this.alive) return;
    // Ignore direct reversal (and no-op duplicates).
    if (dir.x === -this.direction.x && dir.y === -this.direction.y) return;
    if (dir.x === this.direction.x && dir.y === this.direction.y) return;
    this.pendingDirection = dir;
  }

  // Advance the game by one tick. No-op when the game is over.
  step() {
    if (!this.alive) return;
    this.direction = this.pendingDirection;

    const head = this.snake[0];
    const next = { x: head.x + this.direction.x, y: head.y + this.direction.y };

    // Wall collision.
    if (next.x < 0 || next.y < 0 || next.x >= this.boardSize || next.y >= this.boardSize) {
      this.alive = false;
      return;
    }

    const willEat = this.food !== null && next.x === this.food.x && next.y === this.food.y;

    // Self collision. The tail cell vacates this tick unless the snake grows,
    // so exclude the last segment when not eating.
    const bodyToCheck = willEat ? this.snake : this.snake.slice(0, -1);
    if (bodyToCheck.some((s) => s.x === next.x && s.y === next.y)) {
      this.alive = false;
      return;
    }

    this.snake.unshift(next);
    if (willEat) {
      this.score += 1;
      this.food = this.spawnFood();
    } else {
      this.snake.pop();
    }
  }
}

// ---------------------------------------------------------------------------
// Renderer: neon canvas drawing, fully separated from game logic
// ---------------------------------------------------------------------------

// Neon palette (kept here so every visual constant lives in one place).
const NEON = {
  bg: "#030308",
  grid: "rgba(0, 240, 255, 0.07)",       // dim cyan grid lines
  snakeHead: "#eaffff",                  // near-white head, cyan glow
  snakeGlow: "#00f0ff",
  snakeHeadStart: "#00f0ff",             // gradient: head -> tail
  snakeHeadEnd: "#7b3dff",
  snakeTailStart: "#7b3dff",
  snakeTailEnd: "#ff3df5",
  food: "#ff3df5",                       // magenta diamond
  foodGlow: "rgba(255, 61, 245, 0.85)",
};

const Renderer = {
  // Draw one full board frame. `time` (ms) drives the food pulse animation.
  render(ctx, game, cellPx, time) {
    const t = time || 0;
    const size = game.boardSize * cellPx;

    this.drawBackground(ctx, size, game.boardSize, cellPx);
    if (game.food) this.drawFood(ctx, game.food, cellPx, t);
    this.drawSnake(ctx, game, cellPx);
  },

  // Near-black background plus faint neon grid lines.
  drawBackground(ctx, size, boardSize, cellPx) {
    ctx.save();
    ctx.shadowBlur = 0;
    ctx.fillStyle = NEON.bg;
    ctx.fillRect(0, 0, size, size);

    ctx.strokeStyle = NEON.grid;
    ctx.lineWidth = 1;
    ctx.shadowColor = NEON.snakeGlow;
    ctx.shadowBlur = 3; // very soft glow on the lines
    ctx.beginPath();
    for (let i = 1; i < boardSize; i++) {
      const p = i * cellPx + 0.5; // crisp 1px lines
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
    }
    ctx.stroke();
    ctx.restore();
  },

  // Food: pulsing magenta diamond with a breathing glow.
  drawFood(ctx, cell, cellPx, time) {
    const cx = cell.x * cellPx + cellPx / 2;
    const cy = cell.y * cellPx + cellPx / 2;
    const pulse = 0.5 + 0.5 * Math.sin(time / 210); // 0..1
    const r = cellPx * (0.26 + 0.13 * pulse);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4); // diamond orientation
    ctx.fillStyle = NEON.food;
    ctx.shadowColor = NEON.foodGlow;
    ctx.shadowBlur = 8 + 16 * pulse;
    ctx.fillRect(-r, -r, r * 2, r * 2);
    // Hot white core.
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    const core = r * 0.4;
    ctx.fillRect(-core, -core, core * 2, core * 2);
    ctx.restore();
  },

  // Snake: rounded geometric blocks. Body color gradients cyan -> violet ->
  // magenta from head to tail, each segment carrying a neon shadow glow.
  drawSnake(ctx, game, cellPx) {
    const n = game.snake.length;
    for (let i = n - 1; i >= 1; i--) {
      const s = game.snake[i];
      const k = n <= 1 ? 0 : i / (n - 1);
      this.drawCell(ctx, s.x, s.y, cellPx, this.lerpGradient(k), NEON.snakeGlow);
    }
    // Head: bright fill, extra glow, plus a small direction marker.
    const head = game.snake[0];
    this.drawCell(ctx, head.x, head.y, cellPx, NEON.snakeHead, NEON.snakeGlow);
    const hx = head.x * cellPx + cellPx / 2;
    const hy = head.y * cellPx + cellPx / 2;
    const off = cellPx * 0.22;
    ctx.save();
    ctx.fillStyle = "#062030";
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(hx + game.direction.x * off, hy + game.direction.y * off, cellPx * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },

  // Body gradient across the whole snake: cyan -> violet (head half) and
  // violet -> magenta (tail half).
  lerpGradient(t) {
    if (t < 0.5) return this.lerpColor(NEON.snakeHeadStart, NEON.snakeHeadEnd, t * 2);
    return this.lerpColor(NEON.snakeTailStart, NEON.snakeTailEnd, (t - 0.5) * 2);
  },

  // One rounded block. `fill`/`glow` are the fill and shadow colors.
  drawCell(ctx, gx, gy, cellPx, fill, glow) {
    const inset = Math.max(1, Math.round(cellPx * 0.09));
    const x = gx * cellPx + inset;
    const y = gy * cellPx + inset;
    const w = cellPx - inset * 2;
    const r = Math.min(5, w * 0.3);

    ctx.save();
    ctx.fillStyle = fill;
    ctx.shadowColor = glow;
    ctx.shadowBlur = Math.max(6, cellPx * 0.45);
    this.roundRectPath(ctx, x, y, w, w, r);
    ctx.fill();
    ctx.restore();
  },

  // Rounded-rectangle path (kept as a helper for older canvas engines).
  roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  // Linear blend of two #rrggbb hex colors.
  lerpColor(c1, c2, u) {
    const a = parseInt(c1.slice(1), 16);
    const b = parseInt(c2.slice(1), 16);
    const ch = (shift) => {
      const v1 = (a >> shift) & 0xff;
      const v2 = (b >> shift) & 0xff;
      return Math.round(v1 + (v2 - v1) * u);
    };
    const hex = (n) => n.toString(16).padStart(2, "0");
    return "#" + hex(ch(16)) + hex(ch(8)) + hex(ch(0));
  },
};

// ---------------------------------------------------------------------------
// Board sizing helpers
// ---------------------------------------------------------------------------

// Largest board size whose cells stay at least MIN_CELL_PX when the board
// must fit inside the smaller viewport dimension minus UI chrome.
function maxBoardSizeFromViewport() {
  const avail = Math.min(window.innerWidth, window.innerHeight) - UI_CHROME_PX;
  return Math.max(MIN_BOARD_SIZE, Math.floor(avail / MIN_CELL_PX));
}

// Clamp a user-requested board size to [MIN_BOARD_SIZE, MAX_BOARD_SIZE]
// and to what the viewport can hold.
function effectiveBoardSize(requested) {
  const n = Math.trunc(Number(requested));
  const clamped = Number.isFinite(n)
    ? Math.min(MAX_BOARD_SIZE, Math.max(MIN_BOARD_SIZE, n))
    : DEFAULT_BOARD_SIZE;
  return Math.min(clamped, maxBoardSizeFromViewport());
}

// Pixels per cell for a given board size: fit the board into the viewport,
// keep cells >= MIN_CELL_PX (guaranteed by effectiveBoardSize), and cap the
// cell size so tiny boards do not become giant.
function computeCellPx(boardSize) {
  const avail = Math.min(window.innerWidth, window.innerHeight) - UI_CHROME_PX;
  return Math.min(MAX_CELL_PX, Math.max(MIN_CELL_PX, Math.floor(avail / boardSize)));
}

// ---------------------------------------------------------------------------
// Controller: DOM, input, high score, and the game loop
// ---------------------------------------------------------------------------

(function main() {
  const menuEl = document.getElementById("menu");
  const gameEl = document.getElementById("game");
  const boardSizeInput = document.getElementById("board-size");
  const menuHighEl = document.getElementById("menu-high");
  const startBtn = document.getElementById("start-btn");

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score-value");
  const readyEl = document.getElementById("ready");
  const overlayEl = document.getElementById("gameover");
  const finalScoreEl = document.getElementById("final-score");
  const finalHighEl = document.getElementById("final-high");
  const playAgainBtn = document.getElementById("play-again");

  // --- State ---------------------------------------------------------------
  const State = { MENU: "menu", READY: "ready", PLAYING: "playing", GAMEOVER: "gameover" };
  let state = State.MENU;

  let game = null;              // current SnakeGame (null while in the menu)
  let cellPx = 24;              // canvas pixels per cell
  let sessionHighScore = 0;     // in-memory only: resets on page reload

  // --- Start menu ------------------------------------------------------------
  function updateMenuHighScore() {
    menuHighEl.textContent = "Session high score: " + sessionHighScore;
  }

  // Keep the input's upper bound honest (spec: capped by viewport).
  function syncSizeInputBounds() {
    boardSizeInput.max = String(maxBoardSizeFromViewport());
  }

  function startGame() {
    const boardSize = effectiveBoardSize(boardSizeInput.value);
    boardSizeInput.value = String(boardSize); // reflect any clamping

    game = new SnakeGame(boardSize);
    cellPx = computeCellPx(boardSize);
    const pixelSize = boardSize * cellPx;
    canvas.width = pixelSize;
    canvas.height = pixelSize;

    scoreEl.textContent = "0";
    readyEl.hidden = false;
    overlayEl.hidden = true;
    menuEl.hidden = true;
    gameEl.hidden = false;

    state = State.READY;
    window.snake.start();
    Renderer.render(ctx, game, cellPx);
  }

  // --- Ready overlay: any key press begins gameplay --------------------------
  function beginPlay(firstKey) {
    readyEl.hidden = true;
    state = State.PLAYING;
    // If the player's first key is a direction key, honor it.
    const dir = KEY_DIRECTIONS[firstKey];
    if (dir) game.setDirection(dir);
    window.snake.start();
  }

  // --- Game over ---------------------------------------------------------------
  function showGameOver() {
    finalScoreEl.textContent = "Final score: " + game.score;
    finalHighEl.textContent = "Session high score: " + sessionHighScore;
    overlayEl.hidden = false;
  }

  function backToMenu() {
    overlayEl.hidden = true;
    gameEl.hidden = true;
    menuEl.hidden = false;
    updateMenuHighScore();
    syncSizeInputBounds();
    game = null;
    state = State.MENU;
    window.snake.stop();
  }

  // --- High score ---------------------------------------------------------------
  // Updated live whenever the current score passes the session best.
  function updateSessionHighScore() {
    if (game.score > sessionHighScore) {
      sessionHighScore = game.score;
      updateMenuHighScore();
    }
  }

  // --- Input --------------------------------------------------------------------
  window.addEventListener("keydown", (e) => {
    if (state === State.READY) {
      e.preventDefault();
      beginPlay(e.key);
      return;
    }
    if (state !== State.PLAYING) return;

    const dir = KEY_DIRECTIONS[e.key];
    if (!dir) return;
    e.preventDefault(); // stop arrow keys / space from scrolling the page
    game.setDirection(dir);
  });

  startBtn.addEventListener("click", startGame);
  playAgainBtn.addEventListener("click", backToMenu);
  window.addEventListener("resize", syncSizeInputBounds);

  // --- Game loop -----------------------------------------------------------------
  // requestAnimationFrame with a fixed-step accumulator: game logic ticks
  // exactly every TICK_MS regardless of display refresh rate.
  let rafId = null;
  let lastTime = null;
  let accumulator = 0;

  function frame(time) {
    rafId = requestAnimationFrame(frame);

    if (lastTime === null) lastTime = time;
    let dt = time - lastTime;
    lastTime = time;
    if (dt > 250) dt = 250; // clamp after tab was backgrounded

    if (state === State.PLAYING && game.alive) {
      accumulator += dt;
      while (accumulator >= TICK_MS) {
        accumulator -= TICK_MS;
        game.step();
      }
    }
    // Drop a stale accumulator when the game freezes so the snake does not
    // lurch forward when a new game starts.
    else {
      accumulator = 0;
    }

    if (game && state === State.PLAYING && !game.alive) {
      state = State.GAMEOVER;
      updateSessionHighScore();
      showGameOver();
      window.snake.stop();
    }

    if (game) {
      Renderer.render(ctx, game, cellPx, time);
      scoreEl.textContent = String(game.score);
      if (state === State.PLAYING) updateSessionHighScore();
    }
  }

  // --- Window API (used by the in-page self-test) ---------------------------------
  window.snake = {
    get state() { return state; },
    // True while the rAF loop is stopped (used by the self-test to wait out
    // the cancelAnimationFrame race).
    get paused() { return rafId === null; },
    get sessionHighScore() { return sessionHighScore; },
    get game() { return game; },
    get cellPx() { return cellPx; },
    get canvasSize() { return { w: canvas.width, h: canvas.height }; },
    step: () => { if (game) game.step(); },
    setDirection: (dir) => { if (game) game.setDirection(dir); },
    // Force the next food to a specific cell (null: no food).
    set food(cell) { if (game) game.food = cell; },
    // Script the random food spawn (null restores the default).
    set foodRng(fn) {
      if (game) game.spawnFood = fn || SnakeGame.prototype.spawnFood;
    },
    // Begin the rAF loop (no-op if already running).
    start() {
      if (rafId === null) {
        lastTime = null;
        accumulator = 0;
        rafId = requestAnimationFrame(frame);
      }
    },
    // Cancel the rAF loop.
    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },
  };

  // --- Boot --------------------------------------------------------------------
  updateMenuHighScore();
  syncSizeInputBounds();
})();
