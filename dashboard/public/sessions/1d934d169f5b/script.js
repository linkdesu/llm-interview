// Ticket 2: Start menu + score system.
// Builds on ticket 1's playable snake. Adds a start menu (title, configurable
// board size, session high-score, Start Game button), a "press any key to
// start" ready overlay, real-time score during play, and a game-over screen
// showing final score, session high-score, and a Play Again button.
// Session high-score is in-memory only (resets on reload).

const TICK_MS = 150;            // fixed movement interval
const MIN_CELL_PX = 12;         // smallest cell size before capping board
const MIN_BOARD_SIZE = 10;      // smallest allowed board size
const MAX_BOARD_SIZE = 99;      // largest allowed board size

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlayText');
const gameover = document.getElementById('gameover');
const finalScoreEl = document.getElementById('finalScore');
const playAgainBtn = document.getElementById('playAgain');

// Start menu elements.
const menu = document.getElementById('menu');
const titleEl = document.getElementById('title');
const boardSizeInput = document.getElementById('boardSize');
const highScoreEl = document.getElementById('highScore');
const startBtn = document.getElementById('startBtn');
const boardEl = document.getElementById('board');

// Session high score (in-memory; resets on reload).
let highScore = 0;

// Configurable board size. `boardSize` is the number of cells per row/column.
let boardSize = 20;
// Pixel size of the canvas (square). Sized to fit the viewport.
let canvasPx = 600;
// Pixel size of a single cell, derived from canvasPx / boardSize.
let cell = canvasPx / boardSize;

// Game state
let snake, dir, nextDir, food, score, state;
// state: 'menu' | 'ready' (overlay shown) | 'playing' | 'over'

function randCell(n) {
  return Math.floor(Math.random() * n);
}

function randomFood() {
  // Pick a random empty cell (not occupied by the snake).
  let c;
  do {
    c = { x: randCell(boardSize), y: randCell(boardSize) };
  } while (snake.some(s => s.x === c.x && s.y === c.y));
  return c;
}

// Size the canvas to fit the available viewport while respecting the board
// size: each cell must be at least MIN_CELL_PX, and the board must fit the
// smaller viewport dimension minus UI chrome.
function resizeCanvas() {
  // Available square dimension: use the smaller of viewport width/height,
  // leaving room for the title + score + padding (UI chrome).
  const chrome = 180; // title, score, padding
  const avail = Math.min(window.innerWidth, window.innerHeight) - chrome;
  const target = Math.max(MIN_BOARD_SIZE * MIN_CELL_PX, avail);

  // Cap board size so cells stay >= MIN_CELL_PX.
  const maxBoardForCells = Math.floor(avail / MIN_CELL_PX);
  boardSize = Math.max(MIN_BOARD_SIZE, Math.min(MAX_BOARD_SIZE, boardSize));
  boardSize = Math.min(boardSize, maxBoardForCells);
  boardSize = Math.max(MIN_BOARD_SIZE, boardSize);

  boardSizeInput.min = MIN_BOARD_SIZE;
  boardSizeInput.max = MAX_BOARD_SIZE;
  boardSizeInput.value = boardSize;

  canvasPx = Math.round(target);
  canvas.width = canvasPx;
  canvas.height = canvasPx;
  cell = canvasPx / boardSize;
}

function resetGame() {
  const cx = Math.floor(boardSize / 2);
  const cy = Math.floor(boardSize / 2);
  // Length 3, heading right. Body laid out along the row to the left.
  snake = [
    { x: cx, y: cy },
    { x: cx - 1, y: cy },
    { x: cx - 2, y: cy },
  ];
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  score = 0;
  food = randomFood();
  scoreEl.textContent = 'Score: 0';
}

let tickTimer = 0;
let rafId = 0;

// Show the start menu and hide the board overlays.
function showMenu() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = 0;
  }
  state = 'menu';
  menu.classList.remove('hidden');
  overlay.classList.add('hidden');
  gameover.classList.add('hidden');
  resizeCanvas();
  draw();
}

// Begin the "press any key" ready overlay after Start Game is clicked.
function showReady() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = 0;
  }
  resetGame();
  state = 'ready';
  menu.classList.add('hidden');
  overlay.classList.remove('hidden');
  gameover.classList.add('hidden');
  draw();
}

// Called on any key while in 'ready' state: start playing.
function startPlaying() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  state = 'playing';
  overlay.classList.add('hidden');
  tickTimer = setInterval(tick, TICK_MS);
  rafId = requestAnimationFrame(loop);
}

function gameOver() {
  state = 'over';
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = 0;
  }
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  // Update session high score.
  if (score > highScore) {
    highScore = score;
    highScoreEl.textContent = highScore;
  }
  finalScoreEl.textContent = 'Final Score: ' + score + '  |  High Score: ' + highScore;
  gameover.classList.remove('hidden');
}

function setDirection(nx, ny) {
  // Prevent reversing directly into self.
  if (nx === -dir.x && ny === -dir.y) return;
  nextDir = { x: nx, y: ny };
}

function tick() {
  dir = nextDir;
  const head = snake[0];
  const newHead = { x: head.x + dir.x, y: head.y + dir.y };

  // Wall collision.
  if (
    newHead.x < 0 ||
    newHead.y < 0 ||
    newHead.x >= boardSize ||
    newHead.y >= boardSize
  ) {
    gameOver();
    return;
  }

  // Self collision (check against current body; tail will move unless eating).
  const willEat = newHead.x === food.x && newHead.y === food.y;
  const body = willEat ? snake : snake.slice(0, -1);
  if (body.some(s => s.x === newHead.x && s.y === newHead.y)) {
    gameOver();
    return;
  }

  snake.unshift(newHead);

  if (willEat) {
    score += 1;
    scoreEl.textContent = 'Score: ' + score;
    food = randomFood();
  } else {
    snake.pop();
  }
}

function loop() {
  // Rendering loop; game ticks are driven by setInterval(tick, TICK_MS).
  // Keep animating the food pulse on the ready/game-over screens too.
  draw();
  rafId = requestAnimationFrame(loop);
}

// Neon accent colors for the game.
const NEON_HEAD = '#39ff8a';   // bright neon green head
const NEON_BODY = '#00e6e6';   // cyan body
const NEON_FOOD = '#ff5fd8';   // magenta food
const NEON_GRID = '#0a3a3a';   // dim neon grid lines

// Pulsing animation time for the food (seconds), advanced by the render loop.
let foodPulse = 0;

function draw() {
  // Guard: nothing to render until the game has been reset (snake/food set).
  if (!snake || !food) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvasPx, canvasPx);
    return;
  }

  // --- Background: near-black with a faint central vignette. ---
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvasPx, canvasPx);
  const grd = ctx.createRadialGradient(
    canvasPx / 2, canvasPx / 2, 0,
    canvasPx / 2, canvasPx / 2, canvasPx / 1.6
  );
  grd.addColorStop(0, 'rgba(0, 60, 60, 0.18)');
  grd.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, canvasPx, canvasPx);
  ctx.restore();

  // --- Optional faint neon grid lines. ---
  if (cell > 8) {
    ctx.save();
    ctx.strokeStyle = NEON_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < boardSize; i++) {
      const p = i * cell + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, canvasPx);
      ctx.moveTo(0, p);
      ctx.lineTo(canvasPx, p);
    }
    ctx.stroke();
    ctx.restore();
  }

  // --- Border frame with neon glow. ---
  ctx.save();
  ctx.strokeStyle = '#1fffcf88';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#00e6e6';
  ctx.shadowBlur = 10;
  ctx.strokeRect(1, 1, canvasPx - 2, canvasPx - 2);
  ctx.restore();

  drawFood();
  drawSnake();
}

// Draw the food as a pulsing, glowing diamond.
function drawFood() {
  // Pulse the glow between 0.4 and 1.0.
  foodPulse = 0.65 + 0.35 * (0.5 + 0.5 * Math.sin(performance.now() / 380));
  const cx = food.x * cell + cell / 2;
  const cy = food.y * cell + cell / 2;
  const r = (cell / 2) * 0.72 * foodPulse;

  ctx.save();
  ctx.shadowColor = NEON_FOOD;
  ctx.shadowBlur = 18 * foodPulse;
  ctx.fillStyle = NEON_FOOD;
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-r / 2, -r / 2, r, r);
  ctx.restore();
}

// Draw the snake as geometric neon blocks, head brightest with a gradient body.
function drawSnake() {
  const n = snake.length;
  for (let i = n - 1; i >= 0; i--) {
    const seg = snake[i];
    const x = seg.x * cell;
    const y = seg.y * cell;
    const isHead = i === 0;

    // Fade body color from head (green) to tail (cyan) via a gradient.
    const t = n === 1 ? 0 : i / (n - 1);
    ctx.save();
    if (isHead) {
      ctx.shadowColor = NEON_HEAD;
      ctx.shadowBlur = 22;
      ctx.fillStyle = NEON_HEAD;
    } else {
      // Interpolate between cyan (head) and magenta (tail) for the glow/body.
      ctx.shadowColor = NEON_BODY;
      ctx.shadowBlur = 14 * (1 - t * 0.5);
      const g = Math.round(255 - t * 160);
      const b = Math.round(230 + t * 25);
      ctx.fillStyle = `rgb(0, ${g}, ${b})`;
    }

    // Geometric rounded block with a small uniform gap.
    const pad = cell * 0.10;
    const size = cell - pad * 2;
    const radius = Math.max(2, cell * 0.22);
    roundRect(ctx, x + pad, y + pad, size, size, radius);
    ctx.fill();
    ctx.restore();
  }

  // Draw simple eyes on the head pointing in the current direction.
  drawHead();
}

// Geometric rounded-rectangle path helper.
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  ctx.lineTo(x, y + r);
  ctx.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  ctx.closePath();
}

// Eyes on the head to indicate direction.
function drawHead() {
  const head = snake[0];
  const cx = head.x * cell + cell / 2;
  const cy = head.y * cell + cell / 2;
  const ex = dir.x * cell * 0.16;
  const ey = dir.y * cell * 0.16;
  const off = cell * 0.16;
  const er = Math.max(1.5, cell * 0.07);
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  // Two eyes offset perpendicular to heading.
  const px = -dir.y, py = dir.x;
  ctx.beginPath();
  ctx.arc(cx + ex + px * off, cy + ey + py * off, er, 0, Math.PI * 2);
  ctx.arc(cx + ex - px * off, cy + ey - py * off, er, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// --- Input ---
window.addEventListener('keydown', (e) => {
  switch (e.key) {
    case 'ArrowUp':    case 'w': case 'W': setDirection(0, -1); break;
    case 'ArrowDown':  case 's': case 'S': setDirection(0, 1); break;
    case 'ArrowLeft':  case 'a': case 'A': setDirection(-1, 0); break;
    case 'ArrowRight': case 'd': case 'D': setDirection(1, 0); break;
    default: break;
  }

  if (state === 'ready' && (e.key.length === 1 || e.key.startsWith('Arrow'))) {
    // Any non-modifier key (text or arrow) starts play.
    startPlaying();
  }
});

// Validate and clamp board size input to the allowed range.
function applyBoardSize() {
  let v = parseInt(boardSizeInput.value, 10);
  if (isNaN(v)) v = boardSize;
  v = Math.max(MIN_BOARD_SIZE, Math.min(MAX_BOARD_SIZE, v));
  boardSize = v;
  boardSizeInput.value = v;
  resizeCanvas();
  if (state === 'menu') draw();
}

boardSizeInput.addEventListener('change', applyBoardSize);

startBtn.addEventListener('click', () => {
  applyBoardSize();
  showReady();
});

playAgainBtn.addEventListener('click', () => {
  showMenu();
});

// Handle viewport changes: re-size the canvas to fit.
window.addEventListener('resize', () => {
  resizeCanvas();
  if (state === 'menu') draw();
});

// Initialize.
state = 'menu';
menu.classList.remove('hidden');
overlay.classList.add('hidden');
gameover.classList.add('hidden');
showMenu();
