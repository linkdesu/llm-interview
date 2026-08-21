/**
 * Snake Game — Ticket 2: Start Menu + Score System
 *
 * Features:
 *  - Start menu with title, board size input, session high-score, Start button
 *  - "Press any key to start" overlay
 *  - Real-time score during gameplay
 *  - Game-over screen with final score, session high-score, Play Again button
 *  - Session high-score (resets on page reload, no localStorage)
 *  - Configurable board size (default 20, min 10, capped by viewport)
 *
 * Game logic is separated from rendering.
 * Game state is exposed on `window.game` for debugging/testing.
 * The game loop is steppable via `window.game.step()`.
 */

(function () {
  "use strict";

  // ─── Constants ───────────────────────────────────────────────
  const DEFAULT_BOARD_SIZE = 20;
  const MIN_BOARD_SIZE = 10;
  const MAX_BOARD_SIZE = 99;
  const MIN_CELL_SIZE = 12; // Minimum cell size in pixels
  const TICK_MS = 150; // Movement interval (ms)

  // Directions
  const DIR = {
    UP: { x: 0, y: -1 },
    DOWN: { x: 0, y: 1 },
    LEFT: { x: -1, y: 0 },
    RIGHT: { x: 1, y: 0 },
  };

  // Opposite directions (to prevent reversing)
  const OPPOSITE = {};
  OPPOSITE[DIR.UP.x + "," + DIR.UP.y] = DIR.DOWN;
  OPPOSITE[DIR.DOWN.x + "," + DIR.DOWN.y] = DIR.UP;
  OPPOSITE[DIR.LEFT.x + "," + DIR.LEFT.y] = DIR.RIGHT;
  OPPOSITE[DIR.RIGHT.x + "," + DIR.RIGHT.y] = DIR.LEFT;

  // ─── Game State ──────────────────────────────────────────────
  let boardSize;       // Configurable grid size
  let cellSize;        // Calculated pixel size per cell
  let canvasSize;      // Canvas dimensions in pixels
  let snake;           // Array of {x, y} segments, index 0 = head
  let food;            // {x, y}
  let direction;       // Current movement direction
  let nextDirection;   // Buffered direction (applied on next tick)
  let score;
  let highScore;       // Session high-score
  let gameOver;
  let tickInterval;    // setInterval handle
  let animFrameId;     // requestAnimationFrame handle for food pulse
  let pulsePhase = 0;  // Animation phase for pulsing effects

  // Game flow states
  let gameState; // "menu" | "ready" | "playing" | "over"

  // ─── DOM Elements ────────────────────────────────────────────
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const scoreDisplay = document.getElementById("score-display");
  const startMenu = document.getElementById("start-menu");
  const readyOverlay = document.getElementById("ready-overlay");
  const gameOverEl = document.getElementById("game-over");
  const finalScoreEl = document.getElementById("final-score");
  const highScoreFinalEl = document.getElementById("high-score-final");
  const highScoreDisplay = document.getElementById("high-score-display");
  const boardSizeInput = document.getElementById("board-size-input");
  const startBtn = document.getElementById("start-btn");
  const playAgainBtn = document.getElementById("play-again-btn");

  // ─── Initialization ──────────────────────────────────────────

  /**
   * Initialize the session: high score, default board size, etc.
   */
  function initSession() {
    highScore = 0;
    boardSize = DEFAULT_BOARD_SIZE;
    boardSizeInput.value = DEFAULT_BOARD_SIZE;
    updateHighScoreDisplay();
    updateBoardSizeInputLimits();
    resizeCanvas();
  }

  /**
   * Update the board size input min/max based on viewport.
   */
  function updateBoardSizeInputLimits() {
    const maxByViewport = calculateMaxBoardSize();
    const effectiveMax = Math.min(MAX_BOARD_SIZE, maxByViewport);
    boardSizeInput.max = effectiveMax;
    boardSizeInput.min = MIN_BOARD_SIZE;
    // Clamp current value
    let val = parseInt(boardSizeInput.value, 10);
    if (val < MIN_BOARD_SIZE) val = MIN_BOARD_SIZE;
    if (val > effectiveMax) val = effectiveMax;
    boardSizeInput.value = val;
    boardSize = val;
  }

  /**
   * Calculate the maximum board size that fits in the viewport.
   * Account for score display height and padding.
   */
  function calculateMaxBoardSize() {
    const availableHeight = window.innerHeight - 60; // score display + padding
    const availableWidth = window.innerWidth - 20;
    const minDim = Math.min(availableHeight, availableWidth);
    return Math.floor(minDim / MIN_CELL_SIZE);
  }

  /**
   * Resize the canvas to fit the viewport, computing cell size.
   */
  function resizeCanvas() {
    const maxByViewport = calculateMaxBoardSize();
    const effectiveSize = Math.min(boardSize, maxByViewport);
    const availableHeight = window.innerHeight - 60;
    const availableWidth = window.innerWidth - 20;
    const minDim = Math.min(availableHeight, availableWidth);

    cellSize = Math.floor(minDim / effectiveSize);
    // Ensure minimum cell size
    if (cellSize < MIN_CELL_SIZE) {
      cellSize = MIN_CELL_SIZE;
    }

    canvasSize = cellSize * effectiveSize;
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    boardSize = effectiveSize;
  }

  /**
   * Reset all game state to initial values.
   */
  function initGame() {
    resizeCanvas();

    // Snake starts at center, length 3, heading right
    const startX = Math.floor(boardSize / 2);
    const startY = Math.floor(boardSize / 2);
    snake = [
      { x: startX, y: startY },
      { x: startX - 1, y: startY },
      { x: startX - 2, y: startY },
    ];
    direction = DIR.RIGHT;
    nextDirection = DIR.RIGHT;
    score = 0;
    gameOver = false;
    spawnFood();
    updateScoreDisplay();
    hideGameOver();
  }

  /**
   * Spawn food at a random empty cell.
   */
  function spawnFood() {
    let attempts = 0;
    while (attempts < boardSize * boardSize) {
      const x = Math.floor(Math.random() * boardSize);
      const y = Math.floor(Math.random() * boardSize);
      if (!isOnSnake(x, y)) {
        food = { x, y };
        return;
      }
      attempts++;
    }
    // Fallback: shouldn't happen on a reasonable grid
    food = { x: 0, y: 0 };
  }

  /**
   * Check if a position is occupied by the snake.
   */
  function isOnSnake(x, y) {
    for (let i = 0; i < snake.length; i++) {
      if (snake[i].x === x && snake[i].y === y) {
        return true;
      }
    }
    return false;
  }

  // ─── Game Loop ───────────────────────────────────────────────

  /**
   * Start the game loop with fixed tick rate and animation loop.
   */
  function startGameLoop() {
    stopGameLoop();
    tickInterval = setInterval(tick, TICK_MS);
    startAnimationLoop();
  }

  /**
   * Stop the game loop.
   */
  function stopGameLoop() {
    if (tickInterval) {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  /**
   * Single game tick — advance the snake one step.
   * This is also exposed as a steppable function for testing.
   */
  function tick() {
    if (gameOver) return;

    // Apply buffered direction
    direction = nextDirection;

    // Calculate new head position
    const head = snake[0];
    const newHead = {
      x: head.x + direction.x,
      y: head.y + direction.y,
    };

    // Check wall collision
    if (
      newHead.x < 0 ||
      newHead.x >= boardSize ||
      newHead.y < 0 ||
      newHead.y >= boardSize
    ) {
      endGame();
      return;
    }

    // Check self collision
    for (let i = 0; i < snake.length; i++) {
      if (snake[i].x === newHead.x && snake[i].y === newHead.y) {
        endGame();
        return;
      }
    }

    // Move snake: prepend new head
    snake.unshift(newHead);

    // Check food
    if (newHead.x === food.x && newHead.y === food.y) {
      score++;
      updateScoreDisplay();
      spawnFood();
      // Don't remove tail — snake grows
    } else {
      // Remove tail to maintain length
      snake.pop();
    }

    render();
  }

  /**
   * End the game.
   */
  function endGame() {
    gameOver = true;
    stopGameLoop();
    stopAnimationLoop();

    // Update session high-score
    if (score > highScore) {
      highScore = score;
      updateHighScoreDisplay();
    }

    showGameOver();
  }

  // ─── Input Handling ──────────────────────────────────────────

  /**
   * Handle keyboard input for direction changes and game flow.
   */
  function handleKeydown(e) {
    // If on ready overlay, any key starts the game
    if (gameState === "ready") {
      e.preventDefault();
      beginGameplay();
      return;
    }

    if (gameOver) return;

    let newDir = null;

    switch (e.key) {
      case "ArrowUp":
      case "w":
      case "W":
        newDir = DIR.UP;
        break;
      case "ArrowDown":
      case "s":
      case "S":
        newDir = DIR.DOWN;
        break;
      case "ArrowLeft":
      case "a":
      case "A":
        newDir = DIR.LEFT;
        break;
      case "ArrowRight":
      case "d":
      case "D":
        newDir = DIR.RIGHT;
        break;
    }

    if (newDir) {
      e.preventDefault();
      // Prevent reversing into self
      const key = newDir.x + "," + newDir.y;
      if (OPPOSITE[key] !== direction) {
        nextDirection = newDir;
      }
    }
  }

  // ─── Game Flow Transitions ───────────────────────────────────

  /**
   * Show the start menu.
   */
  function showStartMenu() {
    gameState = "menu";
    startMenu.classList.remove("hidden");
    readyOverlay.classList.add("hidden");
    gameOverEl.classList.add("hidden");
    updateHighScoreDisplay();
  }

  /**
   * Transition from start menu to ready overlay.
   */
  function showReadyOverlay() {
    gameState = "ready";
    startMenu.classList.add("hidden");
    readyOverlay.classList.remove("hidden");
    gameOverEl.classList.add("hidden");
  }

  /**
   * Begin actual gameplay: hide overlays, init game, start loop.
   */
  function beginGameplay() {
    gameState = "playing";
    readyOverlay.classList.add("hidden");
    initGame();
    startGameLoop();
    render();
  }

  // ─── Animation Loop (food pulse, ambient glow) ─────────────────

  /**
   * Start the continuous animation loop for pulsing effects.
   */
  function startAnimationLoop() {
    if (animFrameId) return;
    function animate() {
      pulsePhase += 0.08;
      render();
      animFrameId = requestAnimationFrame(animate);
    }
    animFrameId = requestAnimationFrame(animate);
  }

  /**
   * Stop the continuous animation loop.
   */
  function stopAnimationLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // ─── Rendering ─────────────────────────────────────────────────

  /**
   * Render the entire game state with neon effects.
   */
  function render() {
    // Clear canvas with black background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasSize, canvasSize);

    // Skip drawing if game hasn't been initialized
    if (!snake || !food) return;

    drawNeonGrid();
    drawNeonFood();
    drawNeonSnake();
  }

  /**
   * Draw faint neon grid lines.
   */
  function drawNeonGrid() {
    ctx.save();
    ctx.strokeStyle = "rgba(0, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= boardSize; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, canvasSize);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(canvasSize, i * cellSize);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw food as a pulsing neon circle.
   */
  function drawNeonFood() {
    const cx = food.x * cellSize + cellSize / 2;
    const cy = food.y * cellSize + cellSize / 2;
    const pulse = 0.65 + 0.35 * Math.sin(pulsePhase);
    const radius = (cellSize / 2 - 2) * pulse;

    ctx.save();

    // Outer glow
    ctx.shadowColor = "#f0f";
    ctx.shadowBlur = 18 * pulse;
    ctx.fillStyle = "#f0f";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Inner bright core
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255, 200, 255, 0.7)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Draw snake with neon glow — geometric blocks with gradient body.
   */
  function drawNeonSnake() {
    for (let i = snake.length - 1; i >= 0; i--) {
      const seg = snake[i];
      const x = seg.x * cellSize + 1;
      const y = seg.y * cellSize + 1;
      const w = cellSize - 2;
      const h = cellSize - 2;
      const pad = Math.max(1, Math.floor(cellSize * 0.1));

      if (i === 0) {
        // Head: bright cyan with strong glow
        ctx.save();
        ctx.shadowColor = "#0ff";
        ctx.shadowBlur = 14;
        ctx.fillStyle = "#0ff";
        ctx.fillRect(x, y, w, h);

        // Inner highlight (geometric detail)
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(200, 255, 255, 0.5)";
        ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
        ctx.restore();
      } else {
        // Body: green with decreasing intensity toward tail
        const ratio = 1 - (i / snake.length) * 0.6;
        const g = Math.floor(255 * ratio);
        const b = Math.floor(80 * ratio);

        ctx.save();
        ctx.shadowColor = `rgb(0, ${g}, ${b})`;
        ctx.shadowBlur = 8;
        ctx.fillStyle = `rgb(0, ${g}, ${b})`;
        ctx.fillRect(x, y, w, h);

        // Inner highlight
        ctx.shadowBlur = 0;
        ctx.fillStyle = `rgba(0, ${Math.floor(g * 0.6)}, ${Math.floor(b * 0.6)}, 0.5)`;
        ctx.fillRect(x + pad, y + pad, w - pad * 2, h - pad * 2);
        ctx.restore();
      }
    }
  }

  // ─── UI Helpers ──────────────────────────────────────────────

  function updateScoreDisplay() {
    scoreDisplay.textContent = "Score: " + score;
  }

  function updateHighScoreDisplay() {
    highScoreDisplay.textContent = "High Score: " + highScore;
  }

  function showGameOver() {
    finalScoreEl.textContent = "Final Score: " + score;
    highScoreFinalEl.textContent = "High Score: " + highScore;
    gameOverEl.classList.remove("hidden");
  }

  function hideGameOver() {
    gameOverEl.classList.add("hidden");
  }

  // ─── Event Listeners ─────────────────────────────────────────

  document.addEventListener("keydown", handleKeydown);

  // Board size input change
  boardSizeInput.addEventListener("change", function () {
    let val = parseInt(this.value, 10);
    if (isNaN(val) || val < MIN_BOARD_SIZE) val = MIN_BOARD_SIZE;
    if (val > MAX_BOARD_SIZE) val = MAX_BOARD_SIZE;
    this.value = val;
    boardSize = val;
    // If game is not running, resize canvas to reflect new size
    if (gameState === "menu") {
      resizeCanvas();
      render();
    }
  });

  // Window resize: recalculate canvas
  window.addEventListener("resize", function () {
    updateBoardSizeInputLimits();
    if (gameState === "menu") {
      resizeCanvas();
      render();
    }
  });

  // Start button
  startBtn.addEventListener("click", function () {
    // Read board size from input
    let val = parseInt(boardSizeInput.value, 10);
    if (isNaN(val) || val < MIN_BOARD_SIZE) val = MIN_BOARD_SIZE;
    if (val > MAX_BOARD_SIZE) val = MAX_BOARD_SIZE;
    boardSizeInput.value = val;
    boardSize = val;

    showReadyOverlay();
  });

  // Play Again button — returns to start menu
  playAgainBtn.addEventListener("click", function () {
    showStartMenu();
  });

  // ─── Public API (for testing) ────────────────────────────────

  window.game = {
    init: initGame,
    step: tick,
    render: render,
    getState: function () {
      return {
        snake: snake ? snake.map(function (s) { return { x: s.x, y: s.y }; }) : [],
        food: food ? { x: food.x, y: food.y } : null,
        direction: direction || null,
        nextDirection: nextDirection || null,
        score: score || 0,
        highScore: highScore || 0,
        gameOver: gameOver || false,
        boardSize: boardSize || 0,
        cellSize: cellSize || 0,
        gameState: gameState || "menu",
      };
    },
    setBoardSize: function (size) {
      boardSize = size;
      resizeCanvas();
      render();
    },
  };

  // ─── Start ───────────────────────────────────────────────────

  initSession();
  showStartMenu();
  render();
})();
