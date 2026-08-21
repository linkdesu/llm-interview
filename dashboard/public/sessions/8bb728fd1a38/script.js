/* ============================================================
   Browser OS — desktop shell (ticket 1)
   Window manager, desktop icons, taskbar, and clock.
   App content is a placeholder until each app's ticket lands.
   ============================================================ */

"use strict";

/* ---------- App registry ---------- */

const APPS = {
  notepad: { name: "Notepad", icon: "📝", width: 580, height: 400 },
  calculator: { name: "Calculator", icon: "🧮", width: 300, height: 440 },
  minesweeper: { name: "Minesweeper", icon: "💣", width: 440, height: 520 },
  spider: { name: "Spider Solitaire", icon: "🕷️", width: 780, height: 540 },
};

/* ---------- DOM references ---------- */

const desktopEl = document.getElementById("desktop");
const windowsEl = document.getElementById("windows");
const taskbarButtonsEl = document.getElementById("taskbar-buttons");
const clockEl = document.getElementById("clock");

/* ---------- Window manager state ---------- */

const windows = new Map(); // app id -> window DOM element
const appKeyHandlers = new Map(); // app id -> keydown handler (focused-window routing)
let zIndexCounter = 10; // monotonically increasing z-order
let cascadeIndex = 0; // offset so new windows cascade

/* ---------- Helpers ---------- */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/** Size of the area windows may occupy (desktop, above the taskbar). */
function desktopBounds() {
  return { width: desktopEl.clientWidth, height: desktopEl.clientHeight };
}

/** Placeholder body shown until the app itself is implemented. */
function placeholderContent(app) {
  const wrap = document.createElement("div");
  wrap.className = "placeholder";
  const glyph = document.createElement("div");
  glyph.className = "placeholder-glyph";
  glyph.textContent = app.icon;
  const text = document.createElement("p");
  text.textContent =
    app.name + " — placeholder content. This app arrives in a later ticket.";
  wrap.append(glyph, text);
  return wrap;
}

/* ---------- Window creation / closing ---------- */

function createWindow(appId) {
  const app = APPS[appId];
  const win = document.createElement("div");
  win.className = "window";
  win.dataset.app = appId;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", app.name);

  // Title bar: icon, app name, close button
  const titlebar = document.createElement("div");
  titlebar.className = "titlebar";

  const icon = document.createElement("span");
  icon.className = "titlebar-icon";
  icon.textContent = app.icon;
  icon.setAttribute("aria-hidden", "true");

  const title = document.createElement("span");
  title.className = "titlebar-title";
  title.textContent = app.name;

  const closeBtn = document.createElement("button");
  closeBtn.className = "close-btn";
  closeBtn.textContent = "✕";
  closeBtn.setAttribute("aria-label", "Close " + app.name);
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeWindow(appId);
  });

  titlebar.append(icon, title, closeBtn);

  // Body: app content if the app is implemented, placeholder otherwise
  const content = document.createElement("div");
  content.className = "window-content";
  const appRoot = buildAppContent(appId, app);
  content.append(appRoot);
  // Apps can expose a keyboard handler on their root element; the shell
  // routes keydown events to the focused window's app (ticket 3).
  if (typeof appRoot.handleKey === "function") {
    appKeyHandlers.set(appId, appRoot.handleKey);
  }

  win.append(titlebar, content);
  windowsEl.append(win);

  // Size the window, clamped so it always fits the viewport.
  const { width, height } = desktopBounds();
  const w = Math.min(app.width, Math.max(width - 16, 240));
  const h = Math.min(app.height, Math.max(height - 16, 150));
  win.style.width = w + "px";
  win.style.height = h + "px";

  // Cascade new windows; keep the start position inside the viewport.
  const offset = (cascadeIndex % 6) * 28;
  cascadeIndex += 1;
  const x = clamp(48 + offset, 0, Math.max(width - w, 0));
  const y = clamp(32 + offset, 0, Math.max(height - h, 0));
  setPosition(win, x, y);

  // Any interaction with the window focuses and raises it.
  win.addEventListener("pointerdown", () => focusWindow(appId));

  makeDraggable(win, titlebar);
  return win;
}

/** Move the window, keeping it fully inside the desktop area. */
function setPosition(win, x, y) {
  const { width, height } = desktopBounds();
  const w = win.offsetWidth;
  const h = win.offsetHeight;
  win.style.left = clamp(Math.round(x), 0, Math.max(width - w, 0)) + "px";
  win.style.top = clamp(Math.round(y), 0, Math.max(height - h, 0)) + "px";
}

/** Open an app window; an already-open app just gets focus. */
function openApp(appId) {
  if (!APPS[appId]) return;
  if (windows.has(appId)) {
    focusWindow(appId); // single instance per app
    return;
  }
  const win = createWindow(appId);
  windows.set(appId, win);
  addTaskbarButton(appId);
  focusWindow(appId);
}

/** Close an app window and clean up its taskbar button. */
function closeWindow(appId) {
  const win = windows.get(appId);
  if (!win) return;
  windows.delete(appId);
  appKeyHandlers.delete(appId);
  const wasFocused = win.classList.contains("focused");
  win.remove();
  removeTaskbarButton(appId);
  if (wasFocused) {
    // Focus the remaining topmost window, if any.
    let top = null;
    let topZ = -Infinity;
    windows.forEach((w) => {
      const z = Number.parseInt(w.style.zIndex, 10) || 0;
      if (z > topZ) {
        topZ = z;
        top = w;
      }
    });
    if (top) focusWindow(top.dataset.app);
  }
}

/** Raise a window to the top and mark it (and its taskbar button) as focused. */
function focusWindow(appId) {
  const win = windows.get(appId);
  if (!win) return;
  zIndexCounter += 1;
  win.style.zIndex = String(zIndexCounter);
  windows.forEach((w, id) => {
    w.classList.toggle("focused", id === appId);
  });
  taskbarButtonsEl
    .querySelectorAll(".taskbar-btn")
    .forEach((btn) => btn.classList.toggle("active", btn.dataset.app === appId));
}

/* ---------- Title bar dragging ---------- */

function makeDraggable(win, titlebar) {
  let dragging = false;
  let offsetX = 0;
  let offsetY = 0;

  titlebar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest(".close-btn")) return;
    dragging = true;
    win.classList.add("dragging");
    const rect = win.getBoundingClientRect();
    const desktopRect = desktopEl.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    try {
      titlebar.setPointerCapture(e.pointerId);
    } catch (_) {
      /* pointer capture is best-effort */
    }
    e.preventDefault(); // avoid text selection while dragging
  });

  titlebar.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const desktopRect = desktopEl.getBoundingClientRect();
    const x = e.clientX - desktopRect.left - offsetX;
    const y = e.clientY - desktopRect.top - offsetY;
    setPosition(win, x, y); // setPosition clamps to the viewport
  });

  const endDrag = () => {
    if (!dragging) return;
    dragging = false;
    win.classList.remove("dragging");
  };
  titlebar.addEventListener("pointerup", endDrag);
  titlebar.addEventListener("pointercancel", endDrag);
}

/* ---------- Taskbar ---------- */

function addTaskbarButton(appId) {
  const app = APPS[appId];
  const btn = document.createElement("button");
  btn.className = "taskbar-btn";
  btn.dataset.app = appId;
  btn.setAttribute("aria-label", "Focus " + app.name);
  btn.title = app.name;

  const icon = document.createElement("span");
  icon.className = "taskbar-icon";
  icon.textContent = app.icon;
  icon.setAttribute("aria-hidden", "true");

  const label = document.createElement("span");
  label.textContent = app.name;
  btn.append(icon, label);

  btn.addEventListener("click", () => focusWindow(appId));
  taskbarButtonsEl.append(btn);
}

function removeTaskbarButton(appId) {
  const btn = taskbarButtonsEl.querySelector('.taskbar-btn[data-app="' + appId + '"]');
  if (btn) btn.remove();
}

/* ---------- Clock (HH:MM, right end of the taskbar) ---------- */

function formatClock(date) {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

function tickClock() {
  clockEl.textContent = formatClock(new Date());
}

/* ---------- Desktop icons ---------- */

function initIcons() {
  document.querySelectorAll(".desktop-icon").forEach((iconEl) => {
    const appId = iconEl.dataset.app;

    // Single click selects the icon; double click opens the app.
    iconEl.addEventListener("click", () => {
      document
        .querySelectorAll(".desktop-icon.selected")
        .forEach((el) => el.classList.remove("selected"));
      iconEl.classList.add("selected");
    });
    iconEl.addEventListener("dblclick", () => openApp(appId));

    // Keyboard: Enter/Space on the focused icon also opens the app.
    iconEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openApp(appId);
      }
    });
  });
}

/* ---------- Wallpaper (ticket 2) ---------- */

const WALLPAPER_KEY = "browseros.wallpaper";
const DEFAULT_WALLPAPER = "aurora";

/** The eight built-in presets; each id maps to a "wallpaper-<id>" CSS class. */
const WALLPAPERS = [
  { id: "aurora", name: "Aurora" },
  { id: "ocean", name: "Ocean" },
  { id: "sunset", name: "Sunset" },
  { id: "forest", name: "Forest" },
  { id: "midnight", name: "Midnight" },
  { id: "cloud", name: "Cloud" },
  { id: "grid", name: "Grid" },
  { id: "dots", name: "Dots" },
];

let wallpaperMenuEl, pickerEl, pickerGridEl;

function knownWallpaper(id) {
  return WALLPAPERS.some((w) => w.id === id);
}

/** Read the saved wallpaper id (falls back to the default). */
function loadWallpaper() {
  let id = null;
  try {
    id = localStorage.getItem(WALLPAPER_KEY);
  } catch (_) {
    /* storage may be unavailable; use the default */
  }
  return knownWallpaper(id) ? id : DEFAULT_WALLPAPER;
}

/** Swap the desktop to the given preset and persist the choice. */
function applyWallpaper(id, save = true) {
  if (!knownWallpaper(id)) return;
  [...desktopEl.classList]
    .filter((c) => c.startsWith("wallpaper-"))
    .forEach((c) => desktopEl.classList.remove(c));
  desktopEl.classList.add("wallpaper-" + id);
  if (save) {
    try {
      localStorage.setItem(WALLPAPER_KEY, id);
    } catch (_) {
      /* non-fatal: wallpaper still applies for this session */
    }
  }
  updatePickerSelection(id);
}

/* ---------- Desktop context menu ---------- */

function initContextMenu() {
  wallpaperMenuEl = document.getElementById("context-menu");

  // Right-click on the empty desktop opens the menu; over icons or windows
  // we keep the browser's default behavior.
  desktopEl.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".window") || e.target.closest(".desktop-icon")) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });

  // Any left click elsewhere dismisses the menu.
  document.addEventListener("pointerdown", (e) => {
    if (wallpaperMenuEl.classList.contains("open") && !e.target.closest("#context-menu")) {
      hideContextMenu();
    }
  });

  // Esc or window blur dismisses it as well.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideContextMenu();
  });
  window.addEventListener("blur", hideContextMenu);

  wallpaperMenuEl.querySelectorAll(".context-menu-item").forEach((item) => {
    item.addEventListener("click", () => {
      hideContextMenu();
      if (item.dataset.action === "wallpaper") openWallpaperPicker();
    });
  });
}

function showContextMenu(x, y) {
  wallpaperMenuEl.classList.add("open");
  const menuRect = wallpaperMenuEl.getBoundingClientRect();
  // Keep the menu inside the viewport.
  const left = clamp(x, 4, Math.max(window.innerWidth - menuRect.width - 4, 4));
  const top = clamp(y, 4, Math.max(window.innerHeight - menuRect.height - 4, 4));
  wallpaperMenuEl.style.left = left + "px";
  wallpaperMenuEl.style.top = top + "px";
}

function hideContextMenu() {
  if (wallpaperMenuEl) wallpaperMenuEl.classList.remove("open");
}

/* ---------- Wallpaper picker ---------- */

function initWallpaperPicker() {
  pickerEl = document.getElementById("wallpaper-picker");
  pickerGridEl = document.getElementById("picker-grid");

  // Build one thumbnail per preset; the swatch reuses the preset class so
  // the thumbnail is an exact (smaller) rendering of the wallpaper.
  WALLPAPERS.forEach((wp) => {
    const btn = document.createElement("button");
    btn.className = "wallpaper-thumb";
    btn.dataset.id = wp.id;
    btn.setAttribute("aria-label", "Use wallpaper: " + wp.name);

    const swatch = document.createElement("span");
    swatch.className = "thumb-swatch wallpaper-" + wp.id;

    const check = document.createElement("span");
    check.className = "thumb-check";
    check.textContent = "✓";
    check.setAttribute("aria-hidden", "true");

    const label = document.createElement("span");
    label.className = "thumb-label";
    label.textContent = wp.name;

    btn.append(swatch, check, label);
    btn.addEventListener("click", () => applyWallpaper(wp.id));
    pickerGridEl.append(btn);
  });

  document.getElementById("picker-close").addEventListener("click", closeWallpaperPicker);
  document.getElementById("picker-done").addEventListener("click", closeWallpaperPicker);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pickerEl.classList.contains("open")) closeWallpaperPicker();
  });
}

function openWallpaperPicker() {
  pickerEl.classList.add("open");
  updatePickerSelection(currentWallpaperId());
  document.getElementById("picker-done").focus();
}

function closeWallpaperPicker() {
  pickerEl.classList.remove("open");
}

/** Mark the currently active preset in the picker grid. */
function updatePickerSelection(id) {
  if (!pickerGridEl) return;
  pickerGridEl.querySelectorAll(".wallpaper-thumb").forEach((btn) => {
    btn.classList.toggle("selected", btn.dataset.id === id);
  });
}

/** The id of the preset currently applied to the desktop. */
function currentWallpaperId() {
  const match = [...desktopEl.classList].find((c) => c.startsWith("wallpaper-"));
  return match ? match.slice("wallpaper-".length) : DEFAULT_WALLPAPER;
}

function initWallpaper() {
  initContextMenu();
  initWallpaperPicker();
  // Restore the saved preset (an invalid/stale stored id falls back to the
  // default, which is then written back to keep storage consistent).
  applyWallpaper(loadWallpaper());
}

/* ============================================================
   Calculator (ticket 3)
   Immediate-execution semantics (Windows standard mode): the
   pending binary operation is evaluated as soon as its right
   operand is complete, so there is no operator precedence.
   ============================================================ */

const CALC_MAX_DIGITS = 16; // display width limit per entry

/** Map a numeric result to a display string (plain, truncated, or Error). */
function calcFormat(n) {
  if (!Number.isFinite(n)) return "Error";
  if (n === 0) return "0"; // normalise -0
  const rounded = Number(n.toPrecision(15)); // drop float noise (0.1+0.2 -> 0.3)
  let s = String(rounded);
  if (s.includes("e") || s.includes("E")) {
    // JS's own exponential form (|n| >= 1e21 or < 1e-7): tidy the exponent.
    return s.toLowerCase().replace(/e\+?(-?\d+)$/, "e$1");
  }
  if (s.length > CALC_MAX_DIGITS) {
    if (Math.abs(rounded) < 1) {
      // Small decimals: the "0." prefix costs width, so trim digits to fit.
      s = rounded.toPrecision(CALC_MAX_DIGITS - 2)
        .replace(/0+$/, "").replace(/\.$/, "");
    } else {
      // Large integers: switch to a compact exponential form.
      s = rounded.toExponential(6)
        .replace(/\.?0+e/, "e").replace(/e\+?(-?\d+)$/, "e$1");
    }
  }
  return s;
}

/** Parse a displayed entry back to a number (unparseable text counts as 0). */
function calcParse(text) {
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
}

/** Apply a binary operation; division by zero returns Infinity (-> Error). */
function calcApply(a, op, b) {
  switch (op) {
    case "+": return a + b;
    case "\u2212": return a - b;
    case "\u00d7": return a * b;
    case "\u00f7":
      if (b === 0) return Infinity;
      return a / b;
    default: return b;
  }
}

/** Human-readable name for a key, used as its aria-label. */
function calcKeyAria(label, action) {
  if (action === "digit") return "Digit " + label;
  switch (label) {
    case "C": return "Clear";
    case "\u00b1": return "Toggle sign";
    case "%": return "Percent";
    case "\u00f7": return "Divide";
    case "\u00d7": return "Multiply";
    case "\u2212": return "Subtract";
    case "+": return "Add";
    case ".": return "Decimal point";
    case "=": return "Equals";
    default: return label;
  }
}

/**
 * Build the calculator UI. Returns the root element; the element also
 * carries a .handleKey(keydownEvent) method that the shell uses to route
 * keyboard input to this instance while its window is focused.
 */
function buildCalculator() {
  const calc = document.createElement("div");
  calc.className = "calc";

  const display = document.createElement("div");
  display.className = "calc-display";
  display.textContent = "0";
  display.setAttribute("role", "status");
  display.setAttribute("aria-label", "Calculator display");

  const keys = document.createElement("div");
  keys.className = "calc-keys";
  keys.setAttribute("role", "group");
  keys.setAttribute("aria-label", "Calculator keys");
  // [label, action, extra css class]
  const KEYS = [
    ["C", "clear", "calc-key-clear"],
    ["\u00b1", "negate", "calc-key-util"],
    ["%", "percent", "calc-key-util"],
    ["\u00f7", "op", "calc-key-util"],
    ["7", "digit"], ["8", "digit"], ["9", "digit"],
    ["\u00d7", "op", "calc-key-util"],
    ["4", "digit"], ["5", "digit"], ["6", "digit"],
    ["\u2212", "op", "calc-key-util"],
    ["1", "digit"], ["2", "digit"], ["3", "digit"],
    ["+", "op", "calc-key-util"],
    ["0", "digit", "calc-key-zero"],
    [".", "decimal"],
    ["=", "equals", "calc-key-equals"],
  ];
  KEYS.forEach(([label, action, extraClass]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "calc-key" + (extraClass ? " " + extraClass : "");
    btn.dataset.action = action;
    btn.textContent = label;
    btn.setAttribute("aria-label", calcKeyAria(label, action));
    btn.addEventListener("click", () => {
      handleKey(label, action);
      flashKey(btn);
    });
    keys.append(btn);
  });

  calc.append(display, keys);

  /* ----- Calculator state (immediate-execution model) ----- */

  let acc = 0; // stored left operand
  let pendingOp = null; // "+", "\u2212", "\u00d7", "\u00f7" or null
  let entry = "0"; // the number currently shown, as a string
  let entering = false; // true while the user is typing the right operand
  let startNew = true; // next digit starts a fresh entry
  let lastOp = null; // for repeated "=" presses
  let lastOperand = 0;
  let error = false;

  function countDigits(text) {
    return (text.match(/\d/g) || []).length;
  }

  /** Update the display text and its auto-shrinking font size. */
  function render() {
    display.textContent = entry;
    display.classList.toggle("calc-display-error", error);
    const len = entry.length;
    display.classList.toggle("calc-display-small", len > 10);
    display.classList.toggle("calc-display-tiny", len > 14);
  }

  /** Reset the whole calculator to a clean "0" (also clears an Error). */
  function clearAll() {
    error = false;
    acc = 0;
    pendingOp = null;
    entry = "0";
    entering = false;
    startNew = true;
    lastOp = null;
    lastOperand = 0;
    render();
  }

  function pressDigit(d) {
    if (error) clearAll();
    if (startNew) {
      entry = d; // leading zeros collapse to "0" naturally
      entering = true;
      startNew = false;
    } else if (entry === "0" || entry === "-0") {
      entry = (entry === "-0" ? "-" : "") + d; // replace the lone zero
    } else if (countDigits(entry) < CALC_MAX_DIGITS) {
      entry += d;
    }
    render();
  }

  function pressDecimal() {
    if (error) clearAll();
    if (startNew) {
      entry = "0.";
      entering = true;
      startNew = false;
    } else if (!entry.includes(".")) {
      entry += ".";
    }
    render();
  }

  function pressOperator(op) {
    if (error) {
      // Any input leaves the Error state; the new operation starts from 0.
      clearAll();
      pendingOp = op;
      render();
      return;
    }
    const current = calcParse(entry);
    if (pendingOp && !startNew) {
      // A complete "acc op entry" pair: evaluate it immediately.
      const result = calcApply(acc, pendingOp, current);
      if (!Number.isFinite(result)) return showError();
      acc = result;
      entry = calcFormat(result);
      entering = false;
    } else {
      // No pending op (or the operator is being replaced): start a pair.
      acc = current;
    }
    pendingOp = op;
    startNew = true;
    lastOp = null;
    lastOperand = 0;
    render();
  }

  function pressEquals() {
    if (error) return; // only new input leaves the Error state
    let operand;
    let op;
    let left;
    if (pendingOp) {
      // Covers "5 + 3 =" and "5 + =" (the display still shows 5).
      op = pendingOp;
      left = acc;
      operand = calcParse(entry);
    } else if (lastOp) {
      // Repeated "=": re-apply the last operation to the current value.
      op = lastOp;
      left = calcParse(entry);
      operand = lastOperand;
    } else {
      return; // nothing to evaluate, leave the display as-is
    }
    const result = calcApply(left, op, operand);
    if (!Number.isFinite(result)) return showError();
    lastOp = op;
    lastOperand = operand;
    pendingOp = null;
    acc = result;
    entry = calcFormat(result);
    entering = false;
    startNew = true;
    render();
  }

  function pressPercent() {
    if (error) clearAll();
    const value = calcParse(entry);
    let result;
    if (pendingOp === "+" || pendingOp === "\u2212") {
      // "a + b %" means a + (a * b / 100)
      result = (acc * value) / 100;
    } else if (pendingOp === "\u00d7" || pendingOp === "\u00f7") {
      // "a \u00d7 b %" means a \u00d7 (b / 100)
      result = value / 100;
    } else {
      result = 0; // a lone "b %" has nothing to be a percent of
    }
    if (!Number.isFinite(result)) return showError();
    entry = calcFormat(result);
    entering = false;
    startNew = true; // typing a digit now starts a new number
    render();
  }

  function pressNegate() {
    if (error) return;
    if (entry === "0" || entry === "0." || entry === "-0") return;
    entry = entry.startsWith("-") ? entry.slice(1) : "-" + entry;
    render();
  }

  function pressBackspace() {
    if (error) {
      clearAll();
      return;
    }
    if (startNew || !entering) return; // results cannot be edited
    entry = entry.length > 1 ? entry.slice(0, -1) : "0";
    if (entry === "-0") entry = "0";
    render();
  }

  /** Enter the "Error" state (divide by zero). */
  function showError() {
    error = true;
    acc = 0;
    pendingOp = null;
    entry = "Error";
    entering = false;
    startNew = true;
    lastOp = null;
    lastOperand = 0;
    render();
  }

  /** Dispatch a key press by its button action (used by clicks and the keyboard). */
  function handleKey(label, action) {
    switch (action) {
      case "digit": pressDigit(label); break;
      case "decimal": pressDecimal(); break;
      case "op": pressOperator(label); break;
      case "equals": pressEquals(); break;
      case "percent": pressPercent(); break;
      case "negate": pressNegate(); break;
      case "clear": clearAll(); break;
    }
  }

  /** Briefly highlight the key a press maps to (used for keyboard input). */
  function flashKey(btn) {
    if (!btn) return;
    btn.classList.add("pressed");
    setTimeout(() => btn.classList.remove("pressed"), 120);
  }

  /** Find the key element a keyboard label/action maps to. */
  function findKeyEl(label, action) {
    const byLabel = [...keys.querySelectorAll(".calc-key")].find(
      (b) => b.textContent === label);
    if (byLabel) return byLabel;
    if (action === "decimal") return keys.querySelector('.calc-key[data-action="decimal"]');
    if (action === "clear") return keys.querySelector('.calc-key[data-action="clear"]');
    return null;
  }

  /**
   * Keyboard handler routed to this calculator by the shell while its
   * window is focused. Digits, + - * / , . % ± Enter (=) Escape (C)
   * and Backspace are supported.
   */
  function onKeyDown(e) {
    const win = calc.closest(".window");
    if (!win || !win.classList.contains("focused")) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, select")) return;
    let label = null;
    let action = null;
    if (/^[0-9]$/.test(e.key)) {
      label = e.key; action = "digit";
    } else if (e.key === "." || e.key === ",") {
      action = "decimal";
    } else if (e.key === "+") {
      label = "+"; action = "op";
    } else if (e.key === "-") {
      label = "\u2212"; action = "op";
    } else if (e.key === "*" || e.key === "x" || e.key === "X") {
      label = "\u00d7"; action = "op";
    } else if (e.key === "/") {
      label = "\u00f7"; action = "op";
    } else if (e.key === "%") {
      label = "%"; action = "percent";
    } else if (e.key === "\u00b1") {
      label = "\u00b1"; action = "negate";
    } else if (e.key === "Enter" || e.key === "=") {
      label = "="; action = "equals";
    } else if (e.key === "Escape") {
      label = "C"; action = "clear";
    } else if (e.key === "Backspace") {
      if (t && t.closest && t.closest(".calc-key")) return; // native behavior on a focused key
      e.preventDefault();
      pressBackspace();
      return;
    } else {
      return;
    }
    if (t && t.closest && t.closest(".calc-key")) return; // native click already handled it
    e.preventDefault(); // stops "=/Enter" activating a focused button, "/" quick-find, etc.
    handleKey(label, action);
    flashKey(findKeyEl(label, action));
  }

  calc.handleKey = onKeyDown; // consumed by the shell's keyboard router
  render();
  return calc;
}

/** Content builder used by createWindow; placeholder until the app's ticket lands. */
function buildAppContent(appId, app) {
  if (appId === "calculator") return buildCalculator();
  return placeholderContent(app);
}

/* ---------- Startup ---------- */

function init() {
  initIcons();
  initWallpaper();
  tickClock();
  setInterval(tickClock, 1000);

  // Keep windows fully inside the desktop when the viewport resizes:
  // shrink oversized windows and re-clamp their positions.
  window.addEventListener("resize", () => {
    const { width, height } = desktopBounds();
    windows.forEach((win) => {
      const w = Math.min(win.offsetWidth, Math.max(width - 8, 240));
      const h = Math.min(win.offsetHeight, Math.max(height - 8, 150));
      win.style.width = w + "px";
      win.style.height = h + "px";
      const x = Number.parseFloat(win.style.left) || 0;
      const y = Number.parseFloat(win.style.top) || 0;
      setPosition(win, x, y);
    });
  });

  // Keyboard support: route keydown events to the focused window's app
  // (ticket 3: calculator; other apps may register handlers later).
  document.addEventListener("keydown", (e) => {
    windows.forEach((win, appId) => {
      if (!win.classList.contains("focused")) return;
      const handler = appKeyHandlers.get(appId);
      if (handler) handler(e);
    });
  });
}

/* Exposed for debugging / automated testing. */
window.BrowserOS = {
  APPS,
  openApp,
  closeWindow,
  focusWindow,
  windows,
  WALLPAPERS,
  applyWallpaper,
  currentWallpaperId,
  openWallpaperPicker,
  closeWallpaperPicker,
  showContextMenu,
  hideContextMenu,
  calcFormat,
  calcApply,
};

document.addEventListener("DOMContentLoaded", init);
