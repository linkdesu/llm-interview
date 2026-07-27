# Browser OS — Spec

## Overview

A desktop operating system that runs entirely in the browser. The desktop fills the
viewport and hosts four applications (Notepad, Calculator, Minesweeper, Spider
Solitaire) in draggable windows, plus a switchable wallpaper.

## Technical Constraints

- Exactly three files: `index.html`, `style.css`, `script.js`. No other files.
- Fully self-contained: no external assets, no CDN links, no network requests.
- Must work when `index.html` is opened directly in Chrome (`file://`).
- CSS/JS not inlined, not minified or obfuscated, kept readable.
- All UI text in English.

## 1. Desktop Shell

- The desktop fills the whole viewport and shows the current wallpaper.
- Desktop icons for the four apps; double-click an icon to open its window.
- Windows:
  - Title bar showing the app name and a close button.
  - Draggable by the title bar; windows stay within the viewport.
  - Clicking anywhere on a window focuses it and raises it above the others
    (z-order); the focused window is visually distinct (e.g. stronger shadow,
    highlighted title bar).
  - One instance per app: opening an already-open app focuses its window.
- Taskbar, fixed to the bottom of the screen:
  - One button per open window, showing the app name.
  - Clicking a taskbar button focuses the corresponding window.
  - The focused window's button is highlighted.
  - A clock (HH:MM) at the right end of the taskbar.

## 2. Notepad

- Multiple named documents persisted in localStorage.
- A sidebar lists all saved documents; clicking one opens it for editing.
- Actions: New, Save, Delete.
  - New: prompts for a name (or generates "Untitled N") and creates an empty
    document.
  - Save: persists the current document under its name.
  - Delete: removes the current document after confirmation.
- The main area is a plain textarea covering the remaining space.
- The current document name is shown in the window title bar.
- Saved documents survive a page reload.

## 3. Calculator

- Standard calculator: digits 0–9, `+ − × ÷`, decimal point, `%`, `±`, `C`
  (clear), `=`.
- Immediate-execution semantics (like the standard mode of the Windows
  calculator): operations are evaluated as they are entered, no operator
  precedence.
- Display shows the current entry or result; handles divide-by-zero with an
  "Error" state that clears on the next input.
- Keyboard support: digits, `+ - * /`, `.`, `%`, `Enter` (=), `Escape` (C),
  `Backspace`.

## 4. Minesweeper

- Three difficulty levels, selectable in the game window:
  - Beginner: 9×9, 10 mines
  - Intermediate: 16×16, 40 mines
  - Expert: 16×30, 99 mines
- Mines are placed after the first click; the first clicked cell and its
  neighbors are always safe.
- Left click reveals a cell; revealing an empty (zero) cell flood-fills its
  neighbors. Right click toggles a flag.
- Revealing a mine ends the game: all mines are shown, the board locks, and a
  loss is indicated. The game is won when every non-mine cell is revealed; a
  win is indicated and the timer stops.
- Mine counter (total mines − flags placed) and a timer that starts on the
  first click and stops on game end.
- A restart button resets the current difficulty.

## 5. Spider Solitaire

- One suit, 104 cards (two decks). Standard tableau: 10 columns — 4 columns of
  6 cards, 6 columns of 5; the top card of each column is face up. The
  remaining 50 cards form the stock.
- Moving cards:
  - A card (or descending sequence) may be placed on a card of the next higher
    rank (e.g. 7 on 8); any card or sequence may be moved to an empty column.
  - Since there is only one suit, any face-up descending sequence can be moved
    as a group.
  - Turning over a newly exposed face-down card is automatic.
  - Drag-and-drop interaction; an illegal move snaps the cards back.
- Stock: clicking the stock deals one new face-up card onto each of the 10
  columns; this is only allowed when no column is empty.
- A complete descending run from King to Ace (13 cards) is automatically
  removed from the tableau. The game is won when all 8 runs are removed; a win
  message is shown.
- A "New Game" button reshuffles and redeals.

## 6. Wallpaper

- Eight built-in presets, implemented purely in CSS: a mix of solid colors,
  gradients, and simple patterns.
- Right-clicking an empty area of the desktop opens a context menu with a
  "Change wallpaper" entry, leading to a preset picker (grid of thumbnails).
- The selected wallpaper persists in localStorage across reloads.

## Visual Style

- Modern flat design, Windows 11 / macOS as reference: rounded corners
  (8–12px), soft shadows, translucent blurred taskbar, system font stack.
- One consistent color palette across the shell and all four apps.
