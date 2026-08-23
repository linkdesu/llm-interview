// Snake — ticket 2: Start menu + score system
// Game logic is separated from rendering.
//
// Screen states:
//   'menu'    -> start menu visible (title, board size, high score, Start Game)
//   'ready'   -> "Press any key to start" overlay after Start Game
//   'playing' -> active gameplay
//   'over'    -> game over screen (final score, high score, Play Again)

const TICK_MS = 150;        // movement interval
const MIN_CELL = 12;        // smallest cell size in px (spec ~12px)
const MIN_BOARD = 10;       // minimum board size
const MAX_BOARD = 99;       // maximum board size (spec range)

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');

// Start menu elements
const startMenu = document.getElementById('startmenu');
const boardSizeInput = document.getElementById('boardsize');
const highScoreEl = document.getElementById('highscore');
const startBtn = document.getElementById('startbtn');

// Ready overlay
const readyEl = document.getElementById('ready');

// Game over elements
const gameoverEl = document.getElementById('gameover');
const goScoreEl = gameoverEl.querySelector('.go-score');
const goHighEl = gameoverEl.querySelector('.go-high');
const playAgainBtn = document.getElementById('playagain');

// ---- State ----------------------------------------------------------------
let state = 'menu';          // menu | ready | playing | over
let boardSize = 20;          // configured cells per row/column
let cell = 25;               // computed pixel size of one cell
let snake, dir, nextDir, food, score, running, lastTick;
let highScore = 0;           // session high score (resets on reload)

// ---- Board sizing ---------------------------------------------------------
// Compute a cell size so the board fits the viewport minus UI chrome,
// while keeping cells no smaller than MIN_CELL.
function computeCell() {
  const maxW = window.innerWidth - 48;                 // padding + score
  const maxH = window.innerHeight - 120;              // padding + score
  const avail = Math.min(maxW, maxH);
  const px = Math.floor(avail / boardSize);
  return Math.max(MIN_CELL, px);
}

function resizeCanvas() {
  cell = computeCell();
  const total = cell * boardSize;
  canvas.width = total;
  canvas.height = total;
  render();
}

// ---- Menu / screen transitions -------------------------------------------
function showMenu() {
  state = 'menu';
  running = false;
  startMenu.classList.remove('hidden');
  readyEl.classList.add('hidden');
  gameoverEl.classList.add('hidden');
  highScoreEl.textContent = String(highScore);
  resizeCanvas();
}

function beginReady() {
  // Read + validate board size from the input.
  let raw = parseInt(boardSizeInput.value, 10);
  if (isNaN(raw)) raw = 20;
  boardSize = Math.max(MIN_BOARD, Math.min(MAX_BOARD, raw));
  boardSizeInput.value = boardSize;

  cell = computeCell();
  const total = cell * boardSize;
  canvas.width = total;
  canvas.height = total;

  startMenu.classList.add('hidden');
  readyEl.classList.remove('hidden');
  gameoverEl.classList.add('hidden');
  state = 'ready';
  render();
}

function beginPlay() {
  readyEl.classList.add('hidden');
  state = 'playing';
  resetGame();
}

function goToMenu() {
  showMenu();
}

// ---- Game reset -----------------------------------------------------------
function resetGame() {
  const center = Math.floor(boardSize / 2);
  // Snake starts at center, length 3, heading right.
  snake = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  score = 0;
  running = true;
  lastTick = 0;
  placeFood();
  updateScore();
  gameoverEl.classList.add('hidden');
}

function placeFood() {
  const occupied = new Set(snake.map(s => s.x + ',' + s.y));
  const empties = [];
  for (let y = 0; y < boardSize; y++) {
    for (let x = 0; x < boardSize; x++) {
      if (!occupied.has(x + ',' + y)) empties.push({ x, y });
    }
  }
  food = empties[Math.floor(Math.random() * empties.length)];
}

function updateScore() {
  scoreEl.textContent = 'Score: ' + score;
}

// ---- Game step (pure logic, one tick) -------------------------------------
function step() {
  dir = nextDir;

  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

  // Wall collision.
  if (head.x < 0 || head.y < 0 || head.x >= boardSize || head.y >= boardSize) {
    return gameOver();
  }

  // Self collision (check against current body; tail will move unless growing).
  const growing = head.x === food.x && head.y === food.y;
  const bodyToCheck = growing ? snake : snake.slice(0, -1);
  if (bodyToCheck.some(s => s.x === head.x && s.y === head.y)) {
    return gameOver();
  }

  snake.unshift(head);

  if (growing) {
    score++;
    if (score > highScore) highScore = score;
    updateScore();
    placeFood();
  } else {
    snake.pop();
  }
}

function gameOver() {
  running = false;
  state = 'over';
  startMenu.classList.add('hidden');
  readyEl.classList.add('hidden');
  goScoreEl.textContent = 'Final score: ' + score;
  goHighEl.textContent = 'High score: ' + highScore;
  gameoverEl.classList.remove('hidden');
}

// ---- Rendering ------------------------------------------------------------
// Neon accent colors used by the canvas renderer.
const NEON = {
  grid: 'rgba(0, 255, 255, 0.10)',
  gridGlow: 'rgba(0, 255, 255, 0.55)',
  snakeHead: '#39ff14',
  snakeBody: '#0ecc0f',
  snakeGlow: 'rgba(57, 255, 20, 0.85)',
  food: '#ff2fa0',
  foodGlow: 'rgba(255, 47, 160, 0.9)',
};

// Draw a single geometric block with a neon glow. `pad` insets the block from
// the cell border; `round` rounds the corners (0 = sharp square).
function drawGlowBlock(x, y, size, color, glow, pad, round) {
  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = 14;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;

  const inset = pad;
  const bx = x + inset;
  const by = y + inset;
  const bw = size - inset * 2;
  const bh = size - inset * 2;

  if (round > 0) {
    const r = Math.min(round, bw / 2, bh / 2);
    ctx.beginPath();
    ctx.moveTo(bx + r, by);
    ctx.lineTo(bx + bw - r, by);
    ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
    ctx.lineTo(bx + bw, by + bh - r);
    ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
    ctx.lineTo(bx + r, by + bh);
    ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
    ctx.lineTo(bx, by + r);
    ctx.arcTo(bx, by, bx + r, by, r);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(bx, by, bw, bh);
  }
  ctx.restore();
}

function render(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const time = t || 0;

  // Faint neon grid lines with a soft glow.
  ctx.strokeStyle = NEON.grid;
  ctx.shadowColor = NEON.gridGlow;
  ctx.shadowBlur = 4;
  ctx.lineWidth = 1;
  for (let i = 1; i < boardSize; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * cell);
    ctx.lineTo(canvas.width, i * cell);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  if (!snake) return;

  // Food: a pulsing glowing diamond whose size breathes with time `t`.
  if (food) {
    const pulse = 0.5 + 0.5 * Math.sin(time / 220);
    const inset = cell * (0.18 + 0.06 * pulse);
    const cx = food.x * cell + cell / 2;
    const cy = food.y * cell + cell / 2;
    const r = (cell - inset * 2) / 2;
    ctx.save();
    ctx.shadowColor = NEON.foodGlow;
    ctx.shadowBlur = 16 + 8 * pulse;
    ctx.fillStyle = NEON.food;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Snake: gradient from head to tail, geometric rounded blocks with glow.
  const n = snake.length;
  snake.forEach((s, i) => {
    const frac = n === 1 ? 0 : i / (n - 1);
    const shade = 0.55 + 0.45 * (1 - frac); // head brightest
    const color = i === 0 ? NEON.snakeHead : shadeColor(NEON.snakeBody, shade);
    const pad = i === 0 ? 0 : 1.5;
    const round = i === 0 ? cell * 0.35 : cell * 0.22;
    drawGlowBlock(s.x * cell, s.y * cell, cell, color, NEON.snakeGlow, pad, round);
  });

  // Head accent: a slightly brighter core to read as the direction of travel.
  if (n > 0) {
    const h = snake[0];
    const cx = h.x * cell + cell / 2;
    const cy = h.y * cell + cell / 2;
    ctx.save();
    ctx.shadowColor = NEON.snakeHead;
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#d6ffd6';
    ctx.beginPath();
    ctx.arc(cx, cy, cell * 0.12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// Lighten or darken a hex color by a factor using a simple additive blend.
function shadeColor(hex, factor) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((num >> 16) & 255) * factor);
  const g = Math.min(255, ((num >> 8) & 255) * factor);
  const b = Math.min(255, (num & 255) * factor);
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// ---- Loop -----------------------------------------------------------------
function loop(ts) {
  requestAnimationFrame(loop);
  if (state !== 'playing') {
    // Keep the last frame drawn (menu/ready/game-over overlays sit on top).
    if (state === 'menu' || state === 'over') render(ts);
    return;
  }
  if (ts - lastTick >= TICK_MS) {
    lastTick = ts;
    step();
  }
  render(ts);
}

// ---- Input ----------------------------------------------------------------
function setDirection(nx, ny) {
  // Prevent reversing into self.
  if (nx === -dir.x && ny === -dir.y) return;
  nextDir = { x: nx, y: ny };
}

document.addEventListener('keydown', (e) => {
  const key = e.key;

  // From the ready overlay, any key begins gameplay.
  if (state === 'ready') {
    beginPlay();
  }

  // Directional controls (also valid right after starting).
  switch (key) {
    case 'ArrowUp':    case 'w': case 'W': setDirection(0, -1); break;
    case 'ArrowDown':  case 's': case 'S': setDirection(0, 1); break;
    case 'ArrowLeft':  case 'a': case 'A': setDirection(-1, 0); break;
    case 'ArrowRight': case 'd': case 'D': setDirection(1, 0); break;
    default: break;
  }

  // Prevent scrolling for arrow / space keys.
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(key)) {
    e.preventDefault();
  }
});

startBtn.addEventListener('click', () => {
  beginReady();
});

playAgainBtn.addEventListener('click', () => {
  goToMenu();
});

// Keep the board sized correctly when the window is resized (menu state).
window.addEventListener('resize', () => {
  if (state === 'menu') resizeCanvas();
});

// ---- Init -----------------------------------------------------------------
showMenu();
requestAnimationFrame(loop);

// Expose for debugging / testing.
window.__snake = {
  getState: () => state,
  showMenu,
  beginReady,
  beginPlay,
  resetGame,
  step,
  render,
  setDir: setDirection,
  setFood: (x, y) => { food = { x, y }; },
  placeFood,
  state: () => ({ state, snake, dir, nextDir, food, score, running, highScore, boardSize, cell }),
};
