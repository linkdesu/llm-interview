// Snake — Ticket 1: minimal playable snake.
// Game logic is kept separate from rendering. State and controls are
// exposed on window.game so the loop can be stepped from scripts/tests.

const GRID_SIZE = 20; // board is fixed at 20x20 for this ticket
const TICK_MS = 150;  // the snake advances one cell every tick
const CELL_PX = 24;   // canvas pixels per cell

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const scoreEl = document.getElementById('score');
const overlayEl = document.getElementById('overlay');
const overlayTextEl = document.getElementById('overlay-text');
const playAgainBtn = document.getElementById('play-again');

canvas.width = GRID_SIZE * CELL_PX;
canvas.height = GRID_SIZE * CELL_PX;

// ---- State ----
const state = {
  snake: [],              // [{x, y}] cells, head first
  dir: { x: 1, y: 0 },    // current heading (applied each tick)
  nextDir: { x: 1, y: 0 },// latest valid input, applied on the next tick
  food: null,             // {x, y}
  score: 0,
  gameOver: false,
};

let loopTimer = null;

// ---- Game control ----

function resetGame() {
  const c = Math.floor(GRID_SIZE / 2);
  state.snake = [
    { x: c, y: c },
    { x: c - 1, y: c },
    { x: c - 2, y: c },
  ];
  state.dir = { x: 1, y: 0 };
  state.nextDir = { x: 1, y: 0 };
  state.score = 0;
  state.gameOver = false;
  spawnFood();
  updateScore();
}

// Place food on a random cell that the snake does not occupy.
function spawnFood() {
  const occupied = new Set(state.snake.map((p) => p.x + ',' + p.y));
  const empty = [];
  for (let y = 0; y < GRID_SIZE; y++) {
    for (let x = 0; x < GRID_SIZE; x++) {
      if (!occupied.has(x + ',' + y)) empty.push({ x, y });
    }
  }
  state.food = empty[Math.floor(Math.random() * empty.length)];
}

function startGame() {
  resetGame();
  overlayEl.style.display = 'none';
  render();
  startLoop();
}

function startLoop() {
  stopLoop();
  loopTimer = setInterval(step, TICK_MS);
}

function stopLoop() {
  if (loopTimer !== null) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
}

function endGame() {
  state.gameOver = true;
  stopLoop();
  overlayTextEl.textContent = 'Game Over — Score: ' + state.score;
  overlayEl.style.display = 'flex';
  render();
}

// ---- Rules ----

function setDirection(dx, dy) {
  if (state.gameOver) return;
  // A 180-degree reversal is ignored; compare against nextDir so that two
  // valid turns pressed within the same tick are both allowed.
  if (dx === -state.nextDir.x && dy === -state.nextDir.y) return;
  state.nextDir = { x: dx, y: dy };
}

// Advance the game by one tick.
function step() {
  if (state.gameOver) return;

  state.dir = state.nextDir;
  const head = state.snake[0];
  const nx = head.x + state.dir.x;
  const ny = head.y + state.dir.y;

  // Wall collision.
  if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) {
    endGame();
    return;
  }

  const eating = state.food.x === nx && state.food.y === ny;

  // Self collision. The tail cell is safe when it moves away this tick,
  // i.e. when the snake is not growing.
  const body = eating ? state.snake : state.snake.slice(0, -1);
  if (body.some((p) => p.x === nx && p.y === ny)) {
    endGame();
    return;
  }

  state.snake.unshift({ x: nx, y: ny });
  if (eating) {
    state.score += 1;
    updateScore();
    spawnFood();
  } else {
    state.snake.pop();
  }
  render();
}

// ---- Input ----

const KEY_DIRS = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  w: { x: 0, y: -1 },
  s: { x: 0, y: 1 },
  a: { x: -1, y: 0 },
  d: { x: 1, y: 0 },
};

document.addEventListener('keydown', (e) => {
  const d = KEY_DIRS[e.key] || KEY_DIRS[e.key.toLowerCase()];
  if (!d) return;
  e.preventDefault();
  setDirection(d.x, d.y);
});

playAgainBtn.addEventListener('click', startGame);

// ---- Rendering ----

function updateScore() {
  scoreEl.textContent = 'Score: ' + state.score;
}

function render() {
  // Background.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Faint grid lines.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = 1;
  for (let i = 1; i < GRID_SIZE; i++) {
    ctx.beginPath();
    ctx.moveTo(i * CELL_PX + 0.5, 0);
    ctx.lineTo(i * CELL_PX + 0.5, canvas.height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * CELL_PX + 0.5);
    ctx.lineTo(canvas.width, i * CELL_PX + 0.5);
    ctx.stroke();
  }

  // Food.
  if (state.food) {
    ctx.fillStyle = '#e33';
    ctx.fillRect(
      state.food.x * CELL_PX + 2,
      state.food.y * CELL_PX + 2,
      CELL_PX - 4,
      CELL_PX - 4
    );
  }

  // Snake: head in a distinct color, body in green.
  state.snake.forEach((p, i) => {
    ctx.fillStyle = i === 0 ? '#fff' : '#3c6';
    ctx.fillRect(p.x * CELL_PX + 1, p.y * CELL_PX + 1, CELL_PX - 2, CELL_PX - 2);
  });
}

// ---- Exposed for testing / debugging ----

window.game = {
  state,
  GRID_SIZE,
  startGame,
  step,
  setDirection,
  spawnFood,
  startLoop,
  stopLoop,
  render,
};

// Start playing as soon as the page loads.
startGame();
