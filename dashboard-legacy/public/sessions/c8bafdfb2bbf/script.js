/**
 * Neon Snake - Game Logic
 * Controls: Arrow keys / WASD
 */

// ==================== CONSTANTS ====================
const DEFAULT_BOARD_SIZE = 20;
const MIN_BOARD_SIZE = 10;
const MAX_BOARD_SIZE = 30;
const BASE_SPEED = 150; // ms per tick

// ==================== STATE ====================
let sessionHighScore = 0;
let boardSize = DEFAULT_BOARD_SIZE;
let cellSize = 20;
let snake = [];
let food = null;
let direction = { x: 1, y: 0 };
let nextDirection = { x: 1, y: 0 };
let score = 0;
let gameLoop = null;
let gameRunning = false;
let gameStarted = false; // true after any key pressed on waiting overlay

// ==================== DOM REFERENCES ====================
const startMenu = document.getElementById('start-menu');
const waitingOverlay = document.getElementById('waiting-overlay');
const gameScreen = document.getElementById('game-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const scoreDisplay = document.getElementById('score');
const highScoreDisplay = document.getElementById('high-score');
const finalScoreDisplay = document.getElementById('final-score');
const highScoreMsg = document.getElementById('high-score-msg');
const boardSizeInput = document.getElementById('board-size');
const sizePreview = document.getElementById('size-preview');
const sizePreview2 = document.getElementById('size-preview-2');
const startBtn = document.getElementById('start-btn');
const restartBtn = document.getElementById('restart-btn');
const menuBtn = document.getElementById('menu-btn');

// ==================== INITIALIZATION ====================
/**
 * Initialize the game - set up event listeners and initial state.
 */
function init() {
  // Event listeners
  startBtn.addEventListener('click', onStartGame);
  restartBtn.addEventListener('click', onRestartGame);
  menuBtn.addEventListener('click', onMainMenu);
  boardSizeInput.addEventListener('input', applyBoardSize);
  boardSizeInput.addEventListener('change', applyBoardSize);
  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('resize', resizeCanvas);

  // Apply initial board size
  applyBoardSize();
  updateHighScoreDisplay();
}

/**
 * Start button handler: validate size, show waiting overlay.
 */
function onStartGame() {
  applyBoardSize();
  initGameState();
  resizeCanvas();
  calculateCellSize();
  render();
  showScreen(waitingOverlay);
  gameStarted = false;
  gameRunning = false;
}

/**
 * Restart button handler.
 */
function onRestartGame() {
  initGameState();
  resizeCanvas();
  calculateCellSize();
  showScreen(waitingOverlay);
  gameStarted = false;
  gameRunning = false;
}

/**
 * Menu button handler: return to start menu.
 */
function onMainMenu() {
  stopGameLoop();
  gameRunning = false;
  gameStarted = false;
  showScreen(startMenu);
}

// ==================== SCREEN MANAGEMENT ====================
/**
 * Show a specific screen by hiding all others.
 * @param {HTMLElement} screen - The screen element to show.
 */
function showScreen(screen) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  screen.classList.add('active');
}

// ==================== BOARD SIZE ====================
/**
 * Calculate the maximum board size that fits the viewport.
 * @returns {number} Max board size.
 */
function getMaxBoardSizeForViewport() {
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const minCell = 14; // minimum readable cell size
  return Math.max(MIN_BOARD_SIZE, Math.floor(minDim / minCell));
}

/**
 * Clamp and apply the board size from user input.
 */
function applyBoardSize() {
  let val = parseInt(boardSizeInput.value, 10) || DEFAULT_BOARD_SIZE;
  const maxForViewport = getMaxBoardSizeForViewport();
  const cappedMax = Math.min(MAX_BOARD_SIZE, maxForViewport);
  boardSize = Math.max(MIN_BOARD_SIZE, Math.min(cappedMax, val));
  boardSizeInput.value = boardSize;
  sizePreview.textContent = boardSize;
  sizePreview2.textContent = boardSize;
}

// ==================== GAME SETUP ====================
/**
 * Calculate cell size based on canvas dimensions and board size.
 */
function calculateCellSize() {
  cellSize = Math.floor(canvas.width / boardSize);
}

/**
 * Resize canvas to fill available space while keeping aspect ratio.
 */
function resizeCanvas() {
  const container = document.getElementById('app');
  const size = Math.min(container.clientWidth, container.clientHeight) - 40;
  canvas.width = size;
  canvas.height = size;
  calculateCellSize();
}

/**
 * Initialize a new game state (snake, food, score, direction).
 */
function initGameState() {
  const center = Math.floor(boardSize / 2);
  snake = [
    { x: center, y: center },
    { x: center - 1, y: center },
    { x: center - 2, y: center }
  ];
  direction = { x: 1, y: 0 };
  nextDirection = { x: 1, y: 0 };
  score = 0;
  scoreDisplay.textContent = '0';
  placeFood();
}

/**
 * Place food at a random empty cell.
 */
function placeFood() {
  const occupied = new Set(snake.map(s => `${s.x},${s.y}`));
  let pos;
  do {
    pos = {
      x: Math.floor(Math.random() * boardSize),
      y: Math.floor(Math.random() * boardSize)
    };
  } while (occupied.has(`${pos.x},${pos.y}`));
  food = pos;
}

// ==================== GAME LOOP ====================
/**
 * Start the game tick loop.
 */
function startGameLoop() {
  gameRunning = true;
  gameLoop = setInterval(gameTick, BASE_SPEED);
}

/**
 * Stop the game loop.
 */
function stopGameLoop() {
  if (gameLoop) {
    clearInterval(gameLoop);
    gameLoop = null;
  }
  gameRunning = false;
}

/**
 * One game tick: move snake, check collisions, update score.
 */
function gameTick() {
  direction = { ...nextDirection };
  const grew = moveSnake();
  if (checkCollision()) {
    gameOver();
    return;
  }
  if (grew) {
    handleEatFood();
  }
  render();
}

/**
 * Move the snake one step in the current direction.
 * @returns {boolean} True if snake grew, false otherwise.
 */
function moveSnake() {
  const head = snake[0];
  const newHead = {
    x: head.x + direction.x,
    y: head.y + direction.y
  };
  const ateFood = food && newHead.x === food.x && newHead.y === food.y;
  snake.unshift(newHead);
  if (!ateFood) {
    snake.pop();
  }
  return ateFood;
}

/**
 * Check if the snake head collides with walls or itself.
 * @returns {boolean} True if collision occurred.
 */
function checkCollision() {
  const head = snake[0];
  // Wall collision
  if (head.x < 0 || head.x >= boardSize || head.y < 0 || head.y >= boardSize) {
    return true;
  }
  // Self collision (skip head)
  for (let i = 1; i < snake.length; i++) {
    if (snake[i].x === head.x && snake[i].y === head.y) {
      return true;
    }
  }
  return false;
}

/**
 * Handle eating food: grow snake, increase score, place new food.
 */
function handleEatFood() {
  score += 10;
  scoreDisplay.textContent = score;
  placeFood();
}

// ==================== RENDERING ====================
/**
 * Render the game frame.
 */
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  drawFood();
  drawSnake();
}

/**
 * Draw the background grid.
 */
function drawGrid() {
  ctx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= boardSize; i++) {
    const pos = i * cellSize;
    // Vertical lines
    ctx.beginPath();
    ctx.moveTo(pos, 0);
    ctx.lineTo(pos, canvas.height);
    ctx.stroke();
    // Horizontal lines
    ctx.beginPath();
    ctx.moveTo(0, pos);
    ctx.lineTo(canvas.width, pos);
    ctx.stroke();
  }
}

/**
 * Draw the snake with neon styling.
 */
function drawSnake() {
  const pad = 1;
  snake.forEach((seg, i) => {
    const isHead = i === 0;
    const x = seg.x * cellSize + pad;
    const y = seg.y * cellSize + pad;
    const size = cellSize - pad * 2;

    // Color gradient from head to tail
    const hue = 140 + (i / snake.length) * 40;
    const color = `hsl(${hue}, 100%, 55%)`;

    ctx.shadowColor = color;
    ctx.shadowBlur = isHead ? 15 : 8;
    ctx.fillStyle = color;

    // Rounded rectangle for segments
    const r = isHead ? size * 0.3 : size * 0.2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + size - r, y);
    ctx.quadraticCurveTo(x + size, y, x + size, y + r);
    ctx.lineTo(x + size, y + size - r);
    ctx.quadraticCurveTo(x + size, y + size, x + size - r, y + size);
    ctx.lineTo(x + r, y + size);
    ctx.quadraticCurveTo(x, y + size, x, y + size - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();

    // Eyes on head
    if (isHead) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#0a0a0f';
      const eyeSize = size * 0.15;
      const eyeOffset = size * 0.25;
      let ex1, ey1, ex2, ey2;
      if (direction.x === 1) { ex1 = x + size * 0.65; ey1 = y + eyeOffset; ex2 = x + size * 0.65; ey2 = y + size - eyeOffset - eyeSize; }
      else if (direction.x === -1) { ex1 = x + size * 0.2; ey1 = y + eyeOffset; ex2 = x + size * 0.2; ey2 = y + size - eyeOffset - eyeSize; }
      else if (direction.y === -1) { ex1 = x + eyeOffset; ey1 = y + size * 0.2; ex2 = x + size - eyeOffset - eyeSize; ey2 = y + size * 0.2; }
      else { ex1 = x + eyeOffset; ey1 = y + size * 0.65; ex2 = x + size - eyeOffset - eyeSize; ey2 = y + size * 0.65; }
      ctx.fillRect(ex1, ey1, eyeSize, eyeSize);
      ctx.fillRect(ex2, ey2, eyeSize, eyeSize);
    }
  });
  ctx.shadowBlur = 0;
}

/**
 * Draw the food with neon styling.
 */
function drawFood() {
  if (!food) return;
  const x = food.x * cellSize + cellSize / 2;
  const y = food.y * cellSize + cellSize / 2;
  const radius = cellSize * 0.35;

  ctx.shadowColor = '#ff00ff';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#ff00ff';

  // Diamond shape for food
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
  ctx.fill();

  // Inner glow
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  const innerR = radius * 0.4;
  ctx.beginPath();
  ctx.moveTo(x, y - innerR);
  ctx.lineTo(x + innerR, y);
  ctx.lineTo(x, y + innerR);
  ctx.lineTo(x - innerR, y);
  ctx.closePath();
  ctx.fill();
}

// ==================== INPUT HANDLING ====================

/**
 * Main keydown handler: routes to appropriate handler.
 * @param {KeyboardEvent} e
 */
function handleKeyDown(e) {
  // Start on any key if waiting
  handleStartInput(e);
  // Direction control during gameplay
  if (gameRunning) {
    handleDirectionInput(e);
  }
}

/**
 * Handle keydown events for direction changes.
 * @param {KeyboardEvent} e
 */
function handleDirectionInput(e) {
  const key = e.key.toLowerCase();
  let newDir = null;

  if (key === 'arrowup' || key === 'w') newDir = { x: 0, y: -1 };
  else if (key === 'arrowdown' || key === 's') newDir = { x: 0, y: 1 };
  else if (key === 'arrowleft' || key === 'a') newDir = { x: -1, y: 0 };
  else if (key === 'arrowright' || key === 'd') newDir = { x: 1, y: 0 };

  if (newDir) {
    // Prevent reversing into self
    if (newDir.x !== -direction.x || newDir.y !== -direction.y) {
      nextDirection = newDir;
    }
    // Prevent default scrolling for arrow keys
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  }
}

/**
 * Handle any key press on the waiting overlay to begin gameplay.
 * @param {KeyboardEvent} e
 */
function handleStartInput(e) {
  if (!gameStarted && !gameRunning && waitingOverlay.classList.contains('active')) {
    gameStarted = true;
    showScreen(gameScreen);
    startGameLoop();
    render();
  }
}

// ==================== GAME OVER ====================
/**
 * End the game and show game over screen.
 */
function gameOver() {
  stopGameLoop();
  finalScoreDisplay.textContent = score;
  const isNewHigh = updateHighScore();
  highScoreMsg.style.display = isNewHigh ? 'block' : 'none';
  updateHighScoreDisplay();
  showScreen(gameOverScreen);
}

/**
 * Update session high score if current score is higher.
 * @returns {boolean} True if new high score was set.
 */
function updateHighScore() {
  if (score > sessionHighScore) {
    sessionHighScore = score;
    return true;
  }
  return false;
}

/**
 * Update the high score display element.
 */
function updateHighScoreDisplay() {
  highScoreDisplay.textContent = sessionHighScore;
}

// ==================== START ====================
init();
