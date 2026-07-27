# Snake — Tickets

Each ticket is independently verifiable. After completing each ticket, review and test your work before marking it done. For HTML page projects, use the `chrome-devtools-axi` skill to open `index.html` in a browser and verify functionality.

[ ]1. Minimal playable snake: A bare-bones but fully functional snake game with minimal styling.
  - Grid rendered on a `<canvas>` element; board size fixed at default 20.
  - Snake moves, changes direction via keyboard (Arrow keys).
  - Food spawns at random empty cell; eating food grows snake and increments score.
  - Wall/self collision ends the game; game-over message and "Play Again" button.
  - Just enough CSS to be playable — no neon polish yet.
  - After this ticket the model can open `index.html` and play a complete game.

[ ]2. Start menu + score system
  - Start menu: title, board size input (default 20, min 10, capped by viewport), session high-score display, "Start Game" button.
  - "Press any key to start" overlay after clicking Start Game.
  - Real-time score display during play.
  - Game-over screen shows final score, session high-score, and "Play Again" button (returns to start menu).
  - No localStorage — high score resets on page reload.

[ ]3. Neon visual polish
  - Dark background (`#000` or near-black) with neon-bright accent colors.
  - Snake segments: geometric blocks with neon glow effect (canvas shadow properties).
  - Food: distinct shape (circle/diamond) with pulsing/glowing animation.
  - Optional dim neon grid lines.
  - UI elements: clean geometric sans-serif, neon-colored with subtle glow.
  - Code quality: game logic separated from rendering (e.g. game module + render method).
