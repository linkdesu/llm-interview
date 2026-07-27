# Browser OS — Tickets

Execute in order; each ticket is independently verifiable. See `spec.md` for full details.

[ ]1. Desktop shell: Window manager and taskbar.
  - Desktop fills the viewport; icons for Notepad, Calculator, Minesweeper, Spider Solitaire; double-click opens the app (placeholder content is fine at this stage).
  - Draggable windows with title bar (app name + close button), focus/z-order switching, single instance per app, windows constrained to the viewport.
  - Taskbar at the bottom: one button per open window, click to focus, active button highlighted, clock at the right end.

[ ]2. Wallpaper
  - Eight CSS-only presets (solids, gradients, patterns).
  - Right-click on empty desktop → context menu → "Change wallpaper" → preset picker with thumbnails.
  - Selection persists in localStorage.

[ ]3. Calculator
  - Standard layout: digits, `+ − × ÷`, `.`, `%`, `±`, `C`, `=`.
  - Immediate-execution semantics; divide-by-zero shows "Error" until next input.
  - Keyboard support: digits, `+ - * /`, `.`, `%`, `Enter`, `Escape`, `Backspace`.

[ ]4. Notepad
  - Multiple named documents in localStorage; sidebar listing all documents.
  - New / Save / Delete (with confirmation); current document name in the title bar.
  - Documents survive page reload.

[ ]5. Minesweeper
  - Three difficulties: 9×9/10, 16×16/40, 16×30/99, selectable in-window.
  - First click always safe (clicked cell + neighbors); flood fill on empty cells; left click reveal, right click flag.
  - Win/lose detection with board reveal on loss; mine counter; timer starting on first click; restart button.

[ ]6. Spider Solitaire
  - One suit, 104 cards; 10 columns (4×6 + 6×5), top cards face up; 50-card stock.
  - Drag-and-drop moves: descending sequences move as a group; any card/sequence to an empty column; illegal moves snap back; automatic flip of exposed cards.
  - Stock deals one row of 10, only when no column is empty.
  - K→A runs auto-removed; win detection with message; New Game button.
