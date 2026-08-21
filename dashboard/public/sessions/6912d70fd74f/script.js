/**
 * Snake Game — Ticket 3: Neon visual polish
 *
 * Architecture:
 *   - GameLogic module: pure game state, rules, tick, collision
 *   - Renderer module: canvas drawing, neon glow, pulsing food, grid lines
 *   - UI module: DOM management, start menu, overlays
 *   - Input module: keyboard handling
 *   - Main: wiring everything together
 *
 * Neon aesthetic: dark background, glowing geometric blocks, pulsing food,
 * dim neon grid lines, Orbitron geometric font with text-shadow glow.
 */

// ─── DOM References ─────────────────────────────────────────
const startMenu = document.getElementById('start-menu');
const gameArea = document.getElementById('game-area');
const boardSizeInput = document.getElementById('board-size-input');
const highScoreDisplay = document.getElementById('high-score-display');
const startBtn = document.getElementById('start-btn');
const scoreLabel = document.getElementById('score-label');
const highScoreLabel = document.getElementById('high-score-label');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const gameOverDiv = document.getElementById('game-over');
const finalScoreEl = document.getElementById('final-score');
const finalHighScoreEl = document.getElementById('final-high-score');
const playAgainBtn = document.getElementById('play-again-btn');

// ─── Constants ──────────────────────────────────────────────
const TICK_MS = 150;
const MIN_CELL_SIZE = 12;

const DIR = {
  UP:    { x:  0, y: -1 },
  DOWN:  { x:  0, y:  1 },
  LEFT:  { x: -1, y:  0 },
  RIGHT: { x:  1, y:  0 },
};

// ─── Session State ──────────────────────────────────────────
let sessionHighScore = 0;
let configuredBoardSize = 20;
let boardSize = 20;
let cellSize = 20;

// ─── Game State (GameLogic) ─────────────────────────────────
let snake = [];
let direction = DIR.RIGHT;
let nextDirection = DIR.RIGHT;
let food = { x: 0, y: 0 };
let score = 0;
let gameRunning = false;
let gameStarted = false;
let gameOverState = false;
let lastTick = 0;
let animFrameId = null;
let animTime = 0; // for pulsing food animation

// ─── Board Size Calculation ─────────────────────────────────
function computeBoardDimensions() {
  const scoreBarHeight = 40;
  const padding = 40;
  const availableWidth = window.innerWidth - padding;
  const availableHeight = window.innerHeight - scoreBarHeight - padding;

  const maxByWidth = Math.floor(availableWidth / MIN_CELL_SIZE);
  const maxByHeight = Math.floor(availableHeight / MIN_CELL_SIZE);
  const viewportMax = Math.min(maxByWidth, maxByHeight);

  boardSize = Math.max(10, Math.min(configuredBoardSize, viewportMax));

  const cellByWidth = Math.floor(availableWidth / boardSize);
  const cellByHeight = Math.floor(availableHeight / boardSize);
  cellSize = Math.max(MIN_CELL_SIZE, Math.min(cellByWidth, cellByHeight));

  canvas.width = boardSize * cellSize;
  canvas.height = boardSize * cellSize;
}

function updateBoardSizeInput() {
  computeBoardDimensions();
  if (configuredBoardSize !== boardSize) {
    boardSizeInput.title = `Viewport caps board size to ${boardSize}`;
  } else {
    boardSizeInput.title = '';
  }
}

// ─── UI Helpers ─────────────────────────────────────────────
function updateScoreDisplay() {
  scoreLabel.textContent = `Score: ${score}`;
  highScoreDisplay.textContent = sessionHighScore;
  highScoreLabel.textContent = `Best: ${sessionHighScore}`;
}

function showStartMenu() {
  startMenu.style.display = 'flex';
  gameArea.style.display = 'none';
  updateScoreDisplay();
  clearCanvas();
}

function showGameArea() {
  startMenu.style.display = 'none';
  gameArea.style.display = 'block';
  updateScoreDisplay();
  computeBoardDimensions();
}

// ─── Game Logic Module ──────────────────────────────────────

/**
 * Place food at a random cell not occupied by the snake.
 */
function placeFood() {
  const occupied = new Set(snake.map(s => `${s.x},${s.y}`));
  let x, y;
  do {
    x = Math.floor(Math.random() * boardSize);
    y = Math.floor(Math.random() * boardSize);
  } while (occupied.has(`${x},${y}`));
  food = { x, y };
}

/**
 * Reset the game state to initial values (ready to start).
 */
function resetGame() {
  const center = Math.floor(boardSize / 2);
  snake = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center },
  ];
  direction = DIR.RIGHT;
  nextDirection = DIR.RIGHT;
  score = 0;
  placeFood();
  gameOverState = false;
  gameRunning = false;
  gameStarted = false;
  updateScoreDisplay();
}

/**
 * Step the game forward by one tick. Pure game logic — no rendering.
 */
function tick() {
  direction = nextDirection;

  const head = snake[0];
  const newHead = {
    x: head.x + direction.x,
    y: head.y + direction.y,
  };

  // Wall collision
  if (newHead.x < 0 || newHead.x >= boardSize ||
      newHead.y < 0 || newHead.y >= boardSize) {
    endGame();
    return;
  }

  // Self collision
  const eating = newHead.x === food.x && newHead.y === food.y;
  const checkLimit = eating ? snake.length : snake.length - 1;
  for (let i = 0; i < checkLimit; i++) {
    if (snake[i].x === newHead.x && snake[i].y === newHead.y) {
      endGame();
      return;
    }
  }

  snake.unshift(newHead);

  if (eating) {
    score++;
    if (score > sessionHighScore) {
      sessionHighScore = score;
    }
    updateScoreDisplay();
    placeFood();
  } else {
    snake.pop();
  }
}

/**
 * End the game.
 */
function endGame() {
  gameRunning = false;
  gameOverState = true;
  finalScoreEl.textContent = `Score: ${score}`;
  finalHighScoreEl.textContent = `High Score: ${sessionHighScore}`;
  gameOverDiv.style.display = 'flex';
}

// ─── Renderer Module ────────────────────────────────────────

/**
 * Clear the canvas to pure black.
 */
function clearCanvas() {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Draw a dim neon grid on the canvas.
 */
function drawGrid() {
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.04)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= boardSize; i++) {
    // Vertical lines
    ctx.beginPath();
    ctx.moveTo(i * cellSize + 0.5, 0);
    ctx.lineTo(i * cellSize + 0.5, canvas.height);
    ctx.stroke();
    // Horizontal lines
    ctx.beginPath();
    ctx.moveTo(0, i * cellSize + 0.5);
    ctx.lineTo(canvas.width, i * cellSize + 0.5);
    ctx.stroke();
  }
}

/**
 * Draw the snake with neon glow effect.
 * Head is brighter green, body tapers through geometric shades.
 */
function drawSnake() {
  for (let i = snake.length - 1; i >= 0; i--) {
    const seg = snake[i];
    const isHead = i === 0;
    const progress = i / snake.length;

    // Head: bright neon green; body: slightly dimmer, geometric gradient
    const r = Math.floor(0 + 0 * progress);
    const g = Math.floor(255 - 80 * progress);
    const b = Math.floor(0 + 50 * progress);
    const color = `rgb(${r}, ${g}, ${b})`;

    ctx.fillStyle = color;
    ctx.shadowColor = isHead ? '#0f0' : `rgba(0, 255, 0, ${0.6 - 0.3 * progress})`;
    ctx.shadowBlur = isHead ? 15 : 8;

    const gap = isHead ? 0.5 : 1;
    ctx.fillRect(
      seg.x * cellSize + gap,
      seg.y * cellSize + gap,
      cellSize - gap * 2,
      cellSize - gap * 2
    );

    // Geometric inner highlight for head
    if (isHead) {
      ctx.shadowBlur = 0;
      const inset = Math.max(2, cellSize * 0.15);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.fillRect(
        seg.x * cellSize + inset,
        seg.y * cellSize + inset,
        cellSize - inset * 2,
        cellSize - inset * 2
      );

      // Eyes direction indicators
      const eyeSize = Math.max(2, cellSize * 0.15);
      ctx.fillStyle = '#000';
      const cx = seg.x * cellSize + cellSize / 2;
      const cy = seg.y * cellSize + cellSize / 2;
      const eyeOffset = cellSize * 0.2;

      if (direction === DIR.RIGHT || direction === DIR.LEFT) {
        const dirX = direction === DIR.RIGHT ? 1 : -1;
        ctx.fillRect(cx + dirX * eyeOffset - eyeSize / 2, cy - eyeOffset - eyeSize / 2, eyeSize, eyeSize);
        ctx.fillRect(cx + dirX * eyeOffset - eyeSize / 2, cy + eyeOffset - eyeSize / 2, eyeSize, eyeSize);
      } else {
        const dirY = direction === DIR.DOWN ? 1 : -1;
        ctx.fillRect(cx - eyeOffset - eyeSize / 2, cy + dirY * eyeOffset - eyeSize / 2, eyeSize, eyeSize);
        ctx.fillRect(cx + eyeOffset - eyeSize / 2, cy + dirY * eyeOffset - eyeSize / 2, eyeSize, eyeSize);
      }
    }
  }

  // Reset shadow for other draws
  ctx.shadowBlur = 0;
}

/**
 * Draw the food as a pulsing neon diamond/circle shape.
 * @param {number} pulsePhase - animation phase (radians) for pulsing effect
 */
function drawFood(pulsePhase) {
  const cx = food.x * cellSize + cellSize / 2;
  const cy = food.y * cellSize + cellSize / 2;
  const radius = (cellSize / 2 - 2) * (0.85 + 0.15 * Math.sin(pulsePhase));
  const glowIntensity = 0.7 + 0.3 * Math.sin(pulsePhase);

  // Outer glow
  ctx.shadowColor = `rgba(255, 0, 255, ${glowIntensity})`;
  ctx.shadowBlur = 12 + 6 * Math.sin(pulsePhase);

  // Draw diamond shape
  ctx.fillStyle = `rgba(255, 0, 255, ${0.8 + 0.2 * Math.sin(pulsePhase)})`;
  ctx.beginPath();
  const r = radius * 0.75;
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();

  // Inner bright core
  ctx.shadowBlur = 0;
  const coreR = radius * 0.35;
  ctx.fillStyle = `rgba(255, 180, 255, ${0.6 + 0.4 * Math.sin(pulsePhase)})`;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowBlur = 0;
}

/**
 * Render the entire game frame.
 */
function render() {
  clearCanvas();
  drawGrid();
  drawFood(animTime);
  drawSnake();
}

// ─── Game Loop ──────────────────────────────────────────────
function gameLoop(timestamp) {
  if (!gameRunning) return;

  animFrameId = requestAnimationFrame(gameLoop);

  // Update animation time for pulsing
  animTime = timestamp * 0.004; // ~0.4 rad/s pulsing speed

  if (timestamp - lastTick >= TICK_MS) {
    lastTick = timestamp;
    tick();
    render();
  }
}

function startGameLoop() {
  gameRunning = true;
  gameOverState = false;
  lastTick = performance.now();
  render();
  animFrameId = requestAnimationFrame(gameLoop);
}

// ─── Input Handling ─────────────────────────────────────────
function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

function handleKeyDown(e) {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
    e.preventDefault();
  }

  // If start menu is visible, ignore all input
  if (startMenu.style.display !== 'none') return;

  // If overlay showing, any key starts the game
  if (!gameStarted && !gameRunning && !gameOverState && overlay.style.display === 'flex') {
    overlay.style.display = 'none';
    gameStarted = true;
    startGameLoop();
    return;
  }

  if (gameOverState || startMenu.style.display !== 'none') return;

  switch (e.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      if (!isOpposite(DIR.UP, direction)) nextDirection = DIR.UP;
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      if (!isOpposite(DIR.DOWN, direction)) nextDirection = DIR.DOWN;
      break;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      if (!isOpposite(DIR.LEFT, direction)) nextDirection = DIR.LEFT;
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      if (!isOpposite(DIR.RIGHT, direction)) nextDirection = DIR.RIGHT;
      break;
  }
}

// ─── Button Handlers ────────────────────────────────────────
startBtn.addEventListener('click', () => {
  const inputVal = parseInt(boardSizeInput.value, 10);
  if (!isNaN(inputVal) && inputVal >= 10) {
    configuredBoardSize = inputVal;
  } else {
    configuredBoardSize = 20;
  }

  showGameArea();
  resetGame();
  overlay.style.display = 'flex';
  gameStarted = false;
});

playAgainBtn.addEventListener('click', () => {
  gameOverDiv.style.display = 'none';
  showStartMenu();
  resetGame();
});

// ─── Resize Handler ─────────────────────────────────────────
window.addEventListener('resize', () => {
  if (!gameRunning && !gameOverState && gameArea.style.display !== 'none') {
    computeBoardDimensions();
    render();
  }
});

// ─── Event Listeners ────────────────────────────────────────
document.addEventListener('keydown', handleKeyDown);

// ─── Expose game state on `window` for debugging/testing ────
window.snakeGame = {
  getSnake: () => [...snake],
  getDirection: () => direction,
  getNextDirection: () => nextDirection,
  setDirection: (d) => {
    if (!(d.x === -direction.x && d.y === -direction.y)) {
      nextDirection = d;
    }
  },
  getFood: () => ({ ...food }),
  getScore: () => score,
  getSessionHighScore: () => sessionHighScore,
  getGameRunning: () => gameRunning,
  getGameStarted: () => gameStarted,
  getGameOverState: () => gameOverState,
  getBoardSize: () => boardSize,
  getCellSize: () => cellSize,
  getConfiguredBoardSize: () => configuredBoardSize,
  tick: tick,
  reset: resetGame,
  startGameLoop: startGameLoop,
};

// ─── Initial State ──────────────────────────────────────────
showStartMenu();
