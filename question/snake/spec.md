# Snake — Spec

## Overview

A classic Snake game rendered in a neon/geometric visual style. The player controls a snake that moves across a grid, eating food to grow and score points. The game ends when the snake hits a wall or itself.

## Technical Constraints

- Exactly three files: `index.html`, `style.css`, `script.js`. No other files.
- Fully self-contained: no external assets, no CDN links, no network requests.
- Must work when `index.html` is opened directly in Chrome (`file://`).
- CSS/JS not inlined, not minified or obfuscated, kept readable.
- All UI text in English.

## 1. Start Menu

- Title of the game displayed prominently.
- Board size control: a numeric input or slider, default 20, range 10–99 (the actual value is further limited by viewport — see §3).
- Session high-score display (starts at 0, resets on page reload).
- "Start Game" button.

## 2. Ready Overlay

- After clicking "Start Game", a semi-transparent overlay covers the game board.
- Overlay text: "Press any key to start" (or similar).
- Pressing any key removes the overlay and begins gameplay.

## 3. Game Board

- Grid-based board rendered on a `<canvas>` element sized to fit the viewport.
- The number of cells per row/column is the configured board size, but the board must never exceed the smaller viewport dimension (width or height) minus UI chrome (score display, padding).
- If the configured board size would make individual cells smaller than ~12px, cap the size to fit.
- Grid lines (faint neon glow) are optional.

## 4. Gameplay

- The snake starts at the center of the board, length 3, heading right.
- The snake moves one cell per tick at a fixed interval (~150ms).
- Arrow keys and WASD change direction; the snake cannot reverse into itself (e.g. pressing left while heading right is ignored).
- Holding a key does not accelerate; only the last valid direction input before the next tick is used.
- Food appears at a random empty cell; eating it increments score by 1 and adds one segment to the snake tail.
- Collision with a wall or the snake's own body ends the game.
- On game over: the board freezes, a "Game Over" message and final score are shown, and a "Play Again" button returns to the start menu.

## 5. Score

- Current score displayed prominently during gameplay.
- Session high-score: updated whenever the current score exceeds the previous high during the session. Displayed on the start menu and on the game-over screen.
- No localStorage persistence.

## 6. Visual Style: Neon / Geometric

- Dark background (`#000` or near-black).
- Neon-bright accent colors (e.g. cyan `#0ff`, magenta `#f0f`, lime `#0f0`, or similar).
- Snake segments: geometric blocks (rounded or sharp) with a neon glow drawn via canvas shadow properties or overdraw techniques. Segments may use a single consistent accent or a gradient across the body.
- Food: a distinct shape (circle, diamond, or glowing block) with pulsing/glowing animation encouraged.
- Grid lines (if present): dim neon lines.
- UI text and buttons: clean, geometric sans-serif font, neon-colored, with subtle glow on interactive elements.

## 7. Code Quality

- Snake game logic must be cleanly separated from rendering (e.g. a `Game` or `Snake` module/object with a `render(ctx: CanvasRenderingContext2D)` method drawing on Canvas 2D).
- No performance issues: game loop uses `requestAnimationFrame` or `setInterval` with a consistent tick rate; no layout thrashing.
