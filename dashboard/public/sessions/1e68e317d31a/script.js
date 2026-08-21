// ============================================================================
// Snake Game — Minimal Playable (Ticket 1)
// ============================================================================
// Core game logic separated from rendering.
// Game module: state management, collision detection, food placement.
// Renderer: draws snake, food, and grid on canvas.
// ============================================================================

// ---- Constants ----
const BOARD_SIZE = 20;
const TICK_INTERVAL = 150; // ms per tick

// ---- Directions ----
const DIR = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 },
};

// ---- Game State ----
const game = {
  snake: [],          // array of {x, y}
  direction: DIR.RIGHT,
  nextDirection: DIR.RIGHT,
  food: null,         // {x, y}
  score: 0,
  running: false,
  gameOver: false,
};

// ---- Renderer ----
const renderer = {
  canvas: null,
  ctx: null,
  cellSize: 0,

  init(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
  },

  setDimensions(cellSize) {
    this.cellSize = cellSize;
    this.canvas.width = BOARD_SIZE * cellSize;
    this.canvas.height = BOARD_SIZE * cellSize;
  },

  draw() {
    this.clear();
    this.drawFood();
    this.drawSnake();
  },

  clear() {
    const { ctx, cellSize } = this;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    // Draw faint grid
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= BOARD_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, BOARD_SIZE * cellSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(BOARD_SIZE * cellSize, i * cellSize);
      ctx.stroke();
    }
  },

  drawSnake() {
    const { ctx, cellSize } = this;
    ctx.fillStyle = '#0f0';
    for (const seg of game.snake) {
      ctx.fillRect(seg.x * cellSize + 1, seg.y * cellSize + 1, cellSize - 2, cellSize - 2);
    }
  },

  drawFood() {
    if (!game.food) return;
    const { ctx, cellSize } = this;
    ctx.fillStyle = '#f00';
    ctx.fillRect(game.food.x * cellSize + 1, game.food.y * cellSize + 1, cellSize - 2, cellSize - 2);
  },
};

// ---- Game Logic ----

/**
 * Initialize the snake at the center of the board, length 3, heading right.
 */
function initGame() {
  const mid = Math.floor(BOARD_SIZE / 2);
  game.snake = [
    { x: mid, y: mid },
    { x: mid - 1, y: mid },
    { x: mid - 2, y: mid },
  ];
  game.direction = DIR.RIGHT;
  game.nextDirection = DIR.RIGHT;
  game.score = 0;
  game.running = false;
  game.gameOver = false;
  spawnFood();
  updateScoreDisplay();
  hideGameOver();
}

/**
 * Spawn food at a random empty cell.
 */
function spawnFood() {
  const occupied = new Set(game.snake.map(s => `${s.x},${s.y}`));
  let attempts = 0;
  while (attempts < 1000) {
    const x = Math.floor(Math.random() * BOARD_SIZE);
    const y = Math.floor(Math.random() * BOARD_SIZE);
    if (!occupied.has(`${x},${y}`)) {
      game.food = { x, y };
      return;
    }
    attempts++;
  }
}

/**
 * Get the direction key from a key event.
 * Returns null for non-direction keys.
 */
function getDirectionKey(event) {
  const keyMap = {
    ArrowUp: 'UP', ArrowDown: 'DOWN', ArrowLeft: 'LEFT', ArrowRight: 'RIGHT',
    w: 'UP', W: 'UP',
    s: 'DOWN', S: 'DOWN',
    a: 'LEFT', A: 'LEFT',
    d: 'RIGHT', D: 'RIGHT',
  };
  return keyMap[event.key] || null;
}

/**
 * Handle direction key press.
 * Prevents reversing into self.
 */
function handleDirectionKey(event) {
  const dirKey = getDirectionKey(event);
  if (!dirKey) return;
  event.preventDefault();
  const dir = DIR[dirKey];
  // Cannot reverse direction
  if (opposite(dir, game.direction)) return;
  game.nextDirection = dir;
}

/**
 * Check if two directions are opposites.
 */
function opposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

/**
 * Execute one game tick.
 * Moves the snake, checks collisions, handles food.
 */
function tick() {
  if (game.gameOver) return;

  game.direction = game.nextDirection;

  const head = game.snake[0];
  const newHead = {
    x: head.x + game.direction.x,
    y: head.y + game.direction.y,
  };

  // Check wall collision
  if (newHead.x < 0 || newHead.x >= BOARD_SIZE || newHead.y < 0 || newHead.y >= BOARD_SIZE) {
    endGame();
    return;
  }

  // Check self collision
  for (const seg of game.snake) {
    if (seg.x === newHead.x && seg.y === newHead.y) {
      endGame();
      return;
    }
  }

  // Check food
  if (game.food && newHead.x === game.food.x && newHead.y === game.food.y) {
    game.score++;
    updateScoreDisplay();
    // Grow: keep the tail, add new head
    game.snake.unshift(newHead);
    spawnFood();
  } else {
    // Move: add new head, remove tail
    game.snake.unshift(newHead);
    game.snake.pop();
  }

  renderer.draw();
}

/**
 * End the game.
 */
function endGame() {
  game.gameOver = true;
  game.running = false;
  clearInterval(gameLoop);
  showGameOver();
}

// ---- Score Display ----
const scoreDisplay = document.getElementById('score-display');

function updateScoreDisplay() {
  scoreDisplay.textContent = `Score: ${game.score}`;
}

// ---- Game Over Overlay ----
const gameOverEl = document.getElementById('game-over');
const gameOverScore = document.getElementById('game-over-score');

function showGameOver() {
  gameOverScore.textContent = `Score: ${game.score}`;
  gameOverEl.classList.remove('hidden');
}

function hideGameOver() {
  gameOverEl.classList.add('hidden');
}

// ---- Game Loop ----
let gameLoop = null;

function startGameLoop() {
  game.running = true;
  gameLoop = setInterval(tick, TICK_INTERVAL);
}

// ---- Setup ----
function setup() {
  const canvas = document.getElementById('game-canvas');

  // Calculate cell size to fit viewport
  const maxCanvasSize = Math.min(window.innerWidth - 40, window.innerHeight - 80);
  const cellSize = Math.max(12, Math.floor(maxCanvasSize / BOARD_SIZE));

  renderer.init(canvas);
  renderer.setDimensions(cellSize);

  // Initial draw
  initGame();
  renderer.draw();

  // Key handler
  document.addEventListener('keydown', handleDirectionKey);

  // Play Again button
  document.getElementById('play-again-btn').addEventListener('click', () => {
    initGame();
    renderer.draw();
  });
}

// ---- Expose game state on `window` for testing ----
window.game = game;
window.renderer = renderer;
window.initGame = initGame;
window.tick = tick;
window.startGameLoop = startGameLoop;
window.BOARD_SIZE = BOARD_SIZE;
window.TICK_INTERVAL = TICK_INTERVAL;

// ---- Initialize ----
window.addEventListener('DOMContentLoaded', setup);
