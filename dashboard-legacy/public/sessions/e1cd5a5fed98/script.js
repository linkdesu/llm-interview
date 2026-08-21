/**
 * Snake Game — Ticket 2: Start menu + score system.
 *
 * Game logic is separated from rendering:
 *   - SnakeGame handles state, movement, collision, scoring.
 *   - Renderer handles drawing on the canvas.
 *
 * Session high-score tracking (no localStorage).
 */

// ── Constants ──────────────────────────────────────────────

const DEFAULT_BOARD_SIZE = 20;
const TICK_INTERVAL = 150; // ms per tick
const FOOD_ANIM_SPEED = 0.08; // speed of food pulse animation
const PARTICLE_LIFETIME = 30; // ticks before particle fades
const FOOD_PARTICLE_COUNT = 8; // particles on food pickup

// ── Session High Score ─────────────────────────────────────

let sessionHighScore = 0;

// ── Renderer ───────────────────────────────────────────────

const Renderer = {
  ctx: null,
  cellSize: 20,
  foodPulse: 0, // animation phase for food
  particles: [], // active particle effects

  init(canvas) {
    this.ctx = canvas.getContext('2d');
  },

  setCellSize(size) {
    this.cellSize = size;
  },

  clear() {
    this.ctx.fillStyle = '#0d0d0d';
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);
  },

  drawGrid(size) {
    const ctx = this.ctx;
    const cellSize = this.cellSize;
    const boardPixel = size * cellSize;

    // Subtle neon grid lines
    ctx.strokeStyle = '#0a1a2e';
    ctx.lineWidth = 1;

    for (let i = 0; i <= size; i++) {
      const pos = i * cellSize;
      // Vertical lines
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, boardPixel);
      ctx.stroke();
      // Horizontal lines
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(boardPixel, pos);
      ctx.stroke();
    }
  },

  drawSnake(snake) {
    const ctx = this.ctx;
    const cellSize = this.cellSize;
    const padding = 1;
    const segmentSize = cellSize - padding * 2;

    for (let i = 0; i < snake.length; i++) {
      const seg = snake[i];
      const sx = seg.x * cellSize + padding;
      const sy = seg.y * cellSize + padding;

      // Gradient from head to tail (bright head, dim tail)
      const intensity = 1 - (i / (snake.length + 1));
      const r = Math.round(0 * intensity);
      const g = Math.round(255 * intensity);
      const b = Math.round(0 * intensity);
      const color = `rgb(${r},${g},${b})`;

      // Glow based on segment
      const glowAmount = 6 + intensity * 4;
      ctx.shadowColor = color;
      ctx.shadowBlur = glowAmount;
      ctx.fillStyle = color;

      // Rounded rectangle for geometric look
      const radius = Math.max(2, Math.round(cellSize / 8));
      this.roundRect(sx, sy, segmentSize, segmentSize, radius);
    }

    // Draw snake head with extra glow
    if (snake.length > 0) {
      const head = snake[0];
      const hx = head.x * cellSize + padding;
      const hy = head.y * cellSize + padding;
      ctx.shadowColor = '#0f0';
      ctx.shadowBlur = 16;
      ctx.strokeStyle = '#0f0';
      ctx.lineWidth = 2;
      ctx.strokeRect(hx, hy, segmentSize, segmentSize);
    }

    ctx.shadowBlur = 0;
  },

  /** Draw a rounded rectangle. */
  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  },

  /** Update food pulse animation. */
  updateFoodPulse() {
    this.foodPulse += FOOD_ANIM_SPEED;
  },

  /** Draw food with pulsing neon effect. */
  drawFood(food) {
    const ctx = this.ctx;
    const cellSize = this.cellSize;
    const padding = 1;
    const pulse = Math.sin(this.foodPulse) * 0.3 + 0.7; // 0.4 to 1.0
    const glowAmount = 6 + pulse * 6; // 6 to 12
    const fsize = cellSize - padding * 2;

    const fx = food.x * cellSize + padding;
    const fy = food.y * cellSize + padding;

    // Outer glow (larger, dimmer)
    ctx.shadowColor = '#f00';
    ctx.shadowBlur = glowAmount * 2;
    ctx.fillStyle = `rgba(255, 0, 0, ${0.15 * pulse})`;
    ctx.fillRect(fx - 2, fy - 2, fsize + 4, fsize + 4);

    // Main body
    ctx.shadowColor = '#f00';
    ctx.shadowBlur = glowAmount;
    ctx.fillStyle = '#f00';
    ctx.fillRect(fx, fy, fsize, fsize);

    // Inner bright core (shrinks/grows with pulse)
    const corePad = 3 + (1 - pulse) * 3; // 3 to 6
    ctx.shadowColor = '#ff4444';
    ctx.shadowBlur = glowAmount * 0.5;
    ctx.fillStyle = `rgba(255, 68, 68, ${0.5 + pulse * 0.5})`;
    ctx.fillRect(fx + corePad, fy + corePad, fsize - corePad * 2, fsize - corePad * 2);

    // Corner highlights (geometric look)
    ctx.shadowBlur = 0;
    ctx.fillStyle = `rgba(255, 100, 100, ${pulse * 0.7})`;
    ctx.fillRect(fx + 2, fy + 2, 2, 2);
    ctx.fillRect(fx + fsize - 4, fy + 2, 2, 2);
    ctx.fillRect(fx + 2, fy + fsize - 4, 2, 2);
    ctx.fillRect(fx + fsize - 4, fy + fsize - 4, 2, 2);
  },

  // ── Particle System ────────────────────────────────────

  spawnParticles(x, y, count) {
    const cellSize = this.cellSize;
    const cx = x * cellSize + cellSize / 2;
    const cy = y * cellSize + cellSize / 2;

    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = 1 + Math.random() * 3;
      this.particles.push({
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: PARTICLE_LIFETIME + Math.floor(Math.random() * 10),
        color: Math.random() > 0.5 ? '#f00' : '#ff4444',
        size: 2 + Math.random() * 3
      });
    }
  },

  updateParticles() {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.96; // friction
      p.vy *= 0.96;
      p.life--;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
      }
    }
  },

  drawParticles() {
    const ctx = this.ctx;
    for (const p of this.particles) {
      const alpha = Math.min(1, p.life / 10);
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 4;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = alpha;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  }
};

// ── Game State ─────────────────────────────────────────────

/**
 * @typedef {Object} Cell
 * @property {number} x
 * @property {number} y
 */

/**
 * @typedef {'UP'|'DOWN'|'LEFT'|'RIGHT'} Direction
 */

// ── SnakeGame ──────────────────────────────────────────────

class SnakeGame {
  /**
   * @param {number} boardSize - Number of cells per row/column.
   * @param {CanvasRenderingContext2D} ctx
   */
  constructor(boardSize, ctx) {
    this.boardSize = boardSize;
    this.ctx = ctx;

    /** @type {Cell[]} */
    this.snake = [];

    /** @type {Direction} */
    this.direction = 'RIGHT';

    /** @type {Direction} - Queued direction change, applied on next tick. */
    this.nextDirection = 'RIGHT';

    /** @type {Cell} */
    this.food = { x: 0, y: 0 };

    /** @type {number} */
    this.score = 0;

    /** @type {boolean} */
    this.isGameOver = false;

    /** @type {boolean} - Game is running (ready to receive input). */
    this.isRunning = false;
  }

  /** Initialize a fresh game at the given board size. */
  start() {
    this.boardSize = Math.min(this.boardSize, 99);
    const center = Math.floor(this.boardSize / 2);
    this.snake = [
      { x: center, y: center },
      { x: center - 1, y: center },
      { x: center - 2, y: center }
    ];
    this.direction = 'RIGHT';
    this.nextDirection = 'RIGHT';
    this.score = 0;
    this.isGameOver = false;
    this.isRunning = false;
    this.spawnFood();
  }

  /** Start the game — called after the "press any key" overlay. */
  begin() {
    this.isRunning = true;
  }

  /** Change the snake's direction. Ignores invalid reversals. */
  setDirection(newDir) {
    if (!this.isRunning || this.isGameOver) return;

    const opposites = { UP: 'DOWN', DOWN: 'UP', LEFT: 'RIGHT', RIGHT: 'LEFT' };
    if (opposites[newDir] === this.direction) return;

    this.nextDirection = newDir;
  }

  /** Advance the game by one tick. */
  tick() {
    if (!this.isRunning || this.isGameOver) return;

    // Apply queued direction.
    this.direction = this.nextDirection;

    // Compute new head position.
    const head = this.snake[0];
    let nx = head.x;
    let ny = head.y;

    switch (this.direction) {
      case 'UP':    ny--; break;
      case 'DOWN':  ny++; break;
      case 'LEFT':  nx--; break;
      case 'RIGHT': nx++; break;
    }

    // Check wall collision.
    if (nx < 0 || nx >= this.boardSize || ny < 0 || ny >= this.boardSize) {
      this.isGameOver = true;
      return;
    }

    // Check self collision.
    for (const seg of this.snake) {
      if (seg.x === nx && seg.y === ny) {
        this.isGameOver = true;
        return;
      }
    }

    // Move head.
    this.snake.unshift({ x: nx, y: ny });

    // Check food collision.
    if (nx === this.food.x && ny === this.food.y) {
      this.score++;

      // Update session high-score.
      if (this.score > sessionHighScore) {
        sessionHighScore = this.score;
      }

      this.consumeFood();
      this.spawnFood();
    } else {
      // Remove tail segment (no growth).
      this.snake.pop();
    }
  }

  /** Spawn food at a random empty cell. */
  spawnFood() {
    const occupied = new Set(this.snake.map(s => `${s.x},${s.y}`));
    let x, y;

    do {
      x = Math.floor(Math.random() * this.boardSize);
      y = Math.floor(Math.random() * this.boardSize);
    } while (occupied.has(`${x},${y}`));

    this.food = { x, y };
  }

  /** Handle food consumption: particles + score. */
  consumeFood() {
    Renderer.spawnParticles(this.food.x, this.food.y, FOOD_PARTICLE_COUNT);
  }

  /** Get the pixel size of the canvas needed for the board. */
  get boardPixelSize() {
    return this.boardSize * Renderer.cellSize;
  }

  /** Render the current game state to the canvas. */
  render() {
    Renderer.clear();

    if (!this.isGameOver) {
      Renderer.drawGrid(this.boardSize);
      Renderer.drawFood(this.food);
      Renderer.drawSnake(this.snake);
      Renderer.drawParticles();
    }
  }
}

// ── DOM Elements ────────────────────────────────────────────

const canvas = document.getElementById('gameCanvas');
const startMenu = document.getElementById('startMenu');
const readyOverlay = document.getElementById('readyOverlay');
const boardSizeInput = document.getElementById('boardSizeInput');
const menuHighScoreEl = document.getElementById('menuHighScore');
const startGameBtn = document.getElementById('startGameBtn');
const gameHUD = document.getElementById('gameHUD');
const gameScoreEl = document.getElementById('gameScore');
const gameOverOverlay = document.getElementById('gameOver');
const finalScoreEl = document.getElementById('finalScore');
const finalHighScoreEl = document.getElementById('finalHighScore');
const playAgainBtn = document.getElementById('playAgainBtn');

/** Current SnakeGame instance. */
let game = null;

/** Interval id for the game loop. */
let tickInterval = null;

/** Current cell size in pixels. */
let cellSize = Renderer.cellSize;

// ── Canvas Configuration ────────────────────────────────────

/**
 * Configure the canvas size to fit the board within the viewport.
 * Returns the cell size in pixels.
 *
 * The board must never exceed the smaller viewport dimension minus UI chrome.
 * If individual cells would be smaller than ~12px, cap the size.
 */
function configureCanvas() {
  const boardPixel = game.boardSize * cellSize;

  // Fit within viewport, leaving room for score display and padding.
  const maxWidth = Math.min(window.innerWidth - 40, window.innerHeight - 40);
  const maxHeight = maxWidth;

  if (boardPixel > maxWidth) {
    // Scale down to fit viewport.
    const scaledCell = Math.max(12, Math.floor(maxWidth / game.boardSize));
    Renderer.setCellSize(scaledCell);
    canvas.width = game.boardSize * scaledCell;
    canvas.height = game.boardSize * scaledCell;
    cellSize = Renderer.cellSize;
  } else {
    canvas.width = boardPixel;
    canvas.height = boardPixel;
    Renderer.setCellSize(cellSize);
  }

  return Renderer.cellSize;
}

// ── Menu / Overlay Management ───────────────────────────────

/** Show the start menu, hide everything else. */
function showStartMenu() {
  startMenu.classList.remove('hidden');
  readyOverlay.classList.add('hidden');
  gameOverOverlay.classList.add('hidden');
  gameHUD.classList.add('hidden');
  canvas.classList.add('hidden');

  // Update high score display on start menu.
  menuHighScoreEl.textContent = sessionHighScore;
}

/** Hide the start menu, show the ready overlay. */
function showReadyOverlay() {
  startMenu.classList.add('hidden');
  readyOverlay.classList.remove('hidden');
  gameOverOverlay.classList.add('hidden');
  gameHUD.classList.add('hidden');
}

/** Hide ready overlay, show HUD and canvas, start the game loop. */
function startGameplay() {
  readyOverlay.classList.add('hidden');
  gameHUD.classList.remove('hidden');
  canvas.classList.remove('hidden');
  game.begin();
  startGameLoop();
}

/** Show the game-over overlay with scores. */
function showGameOver() {
  game.isGameOver = true;
  clearInterval(tickInterval);
  tickInterval = null;
  finalScoreEl.textContent = game.score;
  finalHighScoreEl.textContent = sessionHighScore;
  gameOverOverlay.classList.remove('hidden');
}

/** Hide game-over overlay, return to start menu. */
function hideGameOver() {
  gameOverOverlay.classList.add('hidden');
  gameHUD.classList.add('hidden');
  canvas.classList.add('hidden');
}

/** Update the real-time score display in the HUD. */
function updateScoreDisplay() {
  gameScoreEl.textContent = `Score: ${game.score}`;
}

// ── Game Lifecycle ──────────────────────────────────────────

/** Start a new game — initialize game state, configure canvas, render. */
function startNewGame() {
  const boardSize = Math.min(99, Math.max(10, parseInt(boardSizeInput.value) || DEFAULT_BOARD_SIZE));
  Renderer.init(canvas);

  game = new SnakeGame(boardSize, canvas.getContext('2d'));
  game.start();

  configureCanvas();
  game.render();
  updateScoreDisplay();
}

/** Start (or restart) the game loop. */
function startGameLoop() {
  if (tickInterval !== null) clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (game) {
      Renderer.updateFoodPulse();
      Renderer.updateParticles();
      game.tick();
      updateScoreDisplay();
      game.render();
      if (game.isGameOver) {
        showGameOver();
      }
    }
  }, TICK_INTERVAL);
}

// ── Start Game Button ───────────────────────────────────────

startGameBtn.addEventListener('click', () => {
  startNewGame();
  showReadyOverlay();
});

// ── Play Again Button ───────────────────────────────────────

playAgainBtn.addEventListener('click', () => {
  hideGameOver();
  showStartMenu();
});

// ── Input Handling ──────────────────────────────────────────

const KEY_MAP = {
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  KeyW: 'UP',
  KeyS: 'DOWN',
  KeyA: 'LEFT',
  KeyD: 'RIGHT'
};

document.addEventListener('keydown', (e) => {
  const dir = KEY_MAP[e.code];

  // If we're on the ready overlay, dismiss it and begin the game on any key.
  if (!readyOverlay.classList.contains('hidden') && game && !game.isRunning) {
    e.preventDefault();
    startGameplay();
    // Apply the direction that triggered the start, if it's a valid direction.
    if (dir) {
      game.setDirection(dir);
    }
    return;
  }

  if (dir) {
    e.preventDefault();

    // If game is running, set the direction.
    if (game) {
      game.setDirection(dir);
    }
  }
});

// ── Expose state on window for debugging / self-test ────────

// Expose via Object.defineProperty so it reflects updates.
Object.defineProperty(window, 'game', {
  configurable: true,
  get() { return game; }
});

Object.defineProperty(window, 'sessionHighScore', {
  configurable: true,
  get() { return sessionHighScore; }
});

// ── Handle Resize ───────────────────────────────────────────

window.addEventListener('resize', () => {
  if (game) {
    const newCell = configureCanvas();
    Renderer.setCellSize(newCell);
    game.render();
  }
});

// ── Initialize ──────────────────────────────────────────────

showStartMenu();
