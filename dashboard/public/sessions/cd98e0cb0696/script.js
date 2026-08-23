/* Browser OS — Desktop shell: Window manager and taskbar (Ticket 1) */

"use strict";

/* ------------------------------------------------------------------ *
 * App registry
 * Each app defines an id, display name, taskbar/desktop icon glyph and
 * color, and a function that builds the window body content. At this
 * stage the apps are placeholders; their real content is added in later
 * tickets. The window manager itself is fully functional.
 * ------------------------------------------------------------------ */

const APPS = {
  notepad: {
    id: "notepad",
    name: "Notepad",
    glyph: "N",
    color: "#0078d4",
    buildContent: (titleEl) => buildNotepad(titleEl),
  },
  calculator: {
    id: "calculator",
    name: "Calculator",
    glyph: "=",
    color: "#2b6cb0",
    buildContent: () => buildCalculator(),
    onClose: (calc) => calc && calc.destroy(),
  },
  minesweeper: {
    id: "minesweeper",
    name: "Minesweeper",
    glyph: "M",
    color: "#c53030",
    width: 720,
    height: 480,
    buildContent: () => buildMinesweeper(),
    onClose: (ms) => ms && ms.destroy(),
  },
  spider: {
    id: "spider",
    name: "Spider Solitaire",
    glyph: "S",
    color: "#2f855a",
    width: 900,
    height: 620,
    buildContent: () => buildSpider(),
    onClose: (sp) => sp && sp.destroy(),
  },
};

/* Build a simple placeholder body for apps not yet implemented. */
function buildPlaceholder(title, hint) {
  const body = document.createElement("div");
  body.className = "window-body";
  body.innerHTML =
    '<div class="placeholder"><div><strong>' +
    title +
    "</strong><br>" +
    hint +
    "</div></div>";
  return body;
}

/* ------------------------------------------------------------------ *
 * Window manager
 * Manages creation, focus/z-order, dragging, sizing constraints and
 * closing of application windows. One instance per app is kept.
 * ------------------------------------------------------------------ */

class WindowManager {
  constructor() {
    this.windows = new Map(); // appId -> window element
    this.state = new Map(); // appId -> { el, z, app }
    this.zCounter = 100;
    this.windowsContainer = document.getElementById("windows");
    this.taskbarButtons = document.getElementById("taskbar-buttons");
  }

  /* Open (or focus) the app for the given id. Single instance per app. */
  open(appId) {
    const app = APPS[appId];
    if (!app) return;

    if (this.state.has(appId)) {
      this.focus(appId);
      return;
    }

    const el = this._createWindowEl(app);
    this.state.set(appId, { el, z: ++this.zCounter, app });
    this.windowsContainer.appendChild(el);
    this._buildTaskbarButton(app);
    this.focus(appId);
  }

  /* Focus an open window, raising it in the z-order. */
  focus(appId) {
    const s = this.state.get(appId);
    if (!s) return;
    s.z = ++this.zCounter;
    s.el.style.zIndex = s.z;
    s.el.classList.add("focused");

    // Unfocus all others.
    for (const [id, st] of this.state.entries()) {
      if (id === appId) continue;
      st.el.classList.remove("focused");
      const btn = this.taskbarButtons.querySelector('[data-app="' + id + '"]');
      if (btn) btn.classList.remove("active");
    }
    const activeBtn = this.taskbarButtons.querySelector('[data-app="' + appId + '"]');
    if (activeBtn) activeBtn.classList.add("active");
  }

  /* Close a window by app id. */
  close(appId) {
    const s = this.state.get(appId);
    if (!s) return;
    // Let the app instance clean up (remove listeners, etc.).
    const inst = s.el.__instance;
    if (inst && typeof inst.destroy === "function") inst.destroy();
    s.el.remove();
    this.state.delete(appId);
    const btn = this.taskbarButtons.querySelector('[data-app="' + appId + '"]');
    if (btn) btn.remove();
  }

  /* Create the DOM for a new window. */
  _createWindowEl(app) {
    const el = document.createElement("div");
    el.className = "window";
    // Cascade new windows so they don't stack exactly on top of each other.
    const offset = this.state.size * 28;
    el.style.setProperty("--x", (80 + offset) + "px");
    el.style.setProperty("--y", (50 + offset) + "px");
    el.style.width = (app.width || 460) + "px";
    el.style.height = (app.height || 320) + "px";

    const titlebar = document.createElement("div");
    titlebar.className = "window-titlebar";

    const icon = document.createElement("div");
    icon.className = "win-icon";
    icon.textContent = app.glyph;
    icon.style.background = app.color;

    const title = document.createElement("div");
    title.className = "win-title";
    title.textContent = app.name;

    const close = document.createElement("button");
    close.className = "win-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.close(app.id);
    });

    titlebar.append(icon, title, close);

    const body = document.createElement("div");
    body.className = "window-body";
    const built = app.buildContent(title);
    const contentEl = (built && built.el) || built;
    body.appendChild(contentEl);
    // Store app-built instance (e.g. a Calculator) for teardown on close.
    if (built && built.instance) el.__instance = built.instance;
    // If the app can supply a dynamic title (e.g. Notepad), use it.
    if (built && typeof built.getTitle === "function") {
      title.textContent = built.getTitle();
    }

    el.append(titlebar, body);

    // Focus on mousedown anywhere in the window.
    el.addEventListener("mousedown", () => this.focus(app.id));

    // Draggable by the title bar.
    this._setupDrag(el, titlebar, app.id);

    return el;
  }

  /* Make a window draggable via the given handle, constrained to viewport. */
  _setupDrag(el, handle, appId) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let origX = 0;
    let origY = 0;

    handle.addEventListener("mousedown", (e) => {
      if (e.target.closest(".win-close")) return;
      e.preventDefault();
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      origX = parseInt(el.style.getPropertyValue("--x") || "0", 10);
      origY = parseInt(el.style.getPropertyValue("--y") || "0", 10);
      this.focus(appId);

      const onMove = (ev) => {
        if (!dragging) return;
        const taskbarH = 48;
        const maxW = window.innerWidth - 8;
        const maxH = window.innerHeight - taskbarH - 8;
        let nx = origX + (ev.clientX - startX);
        let ny = origY + (ev.clientY - startY);
        nx = Math.max(-el.offsetWidth + 80, Math.min(nx, maxW));
        ny = Math.max(0, Math.min(ny, maxH));
        el.style.setProperty("--x", nx + "px");
        el.style.setProperty("--y", ny + "px");
      };

      const onUp = () => {
        dragging = false;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });
  }

  /* Build (or update) a taskbar button for the app. */
  _buildTaskbarButton(app) {
    const btn = document.createElement("button");
    btn.className = "taskbar-button";
    btn.setAttribute("data-app", app.id);

    const icon = document.createElement("span");
    icon.className = "tb-icon";
    icon.textContent = app.glyph;
    icon.style.background = app.color;

    const label = document.createElement("span");
    label.className = "tb-label";
    label.textContent = app.name;

    btn.append(icon, label);
    btn.addEventListener("click", () => this.focus(app.id));
    this.taskbarButtons.appendChild(btn);
  }
}

/* ------------------------------------------------------------------ *
 * Desktop shell wiring: icons, taskbar, clock.
 * ------------------------------------------------------------------ */

function renderDesktopIcons() {
  const container = document.getElementById("desktop-icons");
  container.innerHTML = "";
  for (const app of Object.values(APPS)) {
    const icon = document.createElement("div");
    icon.className = "desktop-icon";
    icon.setAttribute("data-app", app.id);

    const glyph = document.createElement("div");
    glyph.className = "icon-glyph";
    glyph.textContent = app.glyph;
    glyph.style.background = app.color;

    const label = document.createElement("div");
    label.className = "icon-label";
    label.textContent = app.name;

    icon.append(glyph, label);

    // Single click selects; double click opens.
    icon.addEventListener("click", (e) => {
      document
        .querySelectorAll(".desktop-icon.selected")
        .forEach((n) => n.classList.remove("selected"));
      icon.classList.add("selected");
    });
    icon.addEventListener("dblclick", () => wm.open(app.id));

    container.appendChild(icon);
  }
}

/* Update the HH:MM clock in the taskbar every second. */
function startClock() {
  const clockEl = document.getElementById("clock");
  const tick = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    clockEl.textContent = hh + ":" + mm;
  };
  tick();
  setInterval(tick, 1000);
}

/* Clicking empty desktop area clears icon selection. */
function setupDesktopInteraction() {
  const desktop = document.getElementById("desktop");
  desktop.addEventListener("click", (e) => {
    if (e.target.id === "desktop" || e.target.id === "desktop-icons") {
      document
        .querySelectorAll(".desktop-icon.selected")
        .forEach((n) => n.classList.remove("selected"));
    }
  });
}

/* ------------------------------------------------------------------ *
 * Wallpaper presets (Ticket 2)
 * Eight built-in presets, each backed by a CSS class defined in
 * style.css. Presets mix solid colors, gradients and CSS patterns.
 * ------------------------------------------------------------------ */

const WALLPAPERS = [
  { id: "ocean", name: "Ocean", cls: "wp-ocean" },
  { id: "aurora", name: "Aurora", cls: "wp-aurora" },
  { id: "sunset", name: "Sunset", cls: "wp-sunset" },
  { id: "twilight", name: "Twilight", cls: "wp-twilight" },
  { id: "rose", name: "Rose", cls: "wp-rose" },
  { id: "sage", name: "Sage", cls: "wp-sage" },
  { id: "sand", name: "Sand", cls: "wp-sand" },
  { id: "stripes", name: "Stripes", cls: "wp-stripes" },
  { id: "graph", name: "Graph", cls: "wp-graph" },
  { id: "dots", name: "Dots", cls: "wp-dots" },
];

const WALLPAPER_STORAGE_KEY = "browseros.wallpaper";

/* ------------------------------------------------------------------ *
 * WallpaperManager
 * Applies the selected wallpaper, persists the choice in localStorage
 * and restores it on reload.
 * ------------------------------------------------------------------ */

class WallpaperManager {
  constructor() {
    this.desktop = document.getElementById("desktop");
    this.selected = this._load();
    this._apply(this.selected);
  }

  _load() {
    try {
      const stored = localStorage.getItem(WALLPAPER_STORAGE_KEY);
      if (stored && WALLPAPERS.some((w) => w.id === stored)) return stored;
    } catch (e) {
      /* ignore storage errors */
    }
    return "ocean";
  }

  _save(id) {
    try {
      localStorage.setItem(WALLPAPER_STORAGE_KEY, id);
    } catch (e) {
      /* ignore storage errors */
    }
  }

  /* Apply a wallpaper id, update the DOM and persist the choice. */
  set(id) {
    if (!WALLPAPERS.some((w) => w.id === id)) return;
    this.selected = id;
    this._apply(id);
    this._save(id);
  }

  _apply(id) {
    WALLPAPERS.forEach((w) => this.desktop.classList.remove(w.cls));
    const w = WALLPAPERS.find((x) => x.id === id);
    if (w) this.desktop.classList.add(w.cls);
  }

  /* Current selected wallpaper id. */
  get current() {
    return this.selected;
  }
}

/* ------------------------------------------------------------------ *
 * Context menu + Wallpaper picker (Ticket 2)
 * Right-clicking an empty desktop area opens a context menu with a
 * "Change wallpaper" entry that reveals a grid of preset thumbnails.
 * ------------------------------------------------------------------ */

class WallpaperUI {
  constructor(manager) {
    this.manager = manager;
    this.desktop = document.getElementById("desktop");
    this._buildContextMenu();
    this._buildPicker();
    this._setupEvents();
  }

  _buildContextMenu() {
    this.menu = document.createElement("div");
    this.menu.className = "context-menu";

    const title = document.createElement("div");
    title.className = "context-menu-title";
    title.textContent = "Desktop";
    this.menu.appendChild(title);

    const changeBtn = document.createElement("button");
    changeBtn.className = "context-menu-item";
    changeBtn.innerHTML =
      '<span class="cm-icon">🖼</span>Change wallpaper';
    changeBtn.addEventListener("click", () => {
      this.hideMenu();
      this.showPicker();
    });
    this.menu.appendChild(changeBtn);

    this.menuEl = this.menu;
    document.body.appendChild(this.menu);
  }

  _buildPicker() {
    this.picker = document.createElement("div");
    this.picker.className = "wallpaper-picker";

    const heading = document.createElement("h2");
    heading.textContent = "Change wallpaper";
    this.picker.appendChild(heading);

    const grid = document.createElement("div");
    grid.className = "wp-grid";
    this.grid = grid;

    WALLPAPERS.forEach((w) => {
      const thumb = document.createElement("div");
      thumb.className = "wp-thumbnail";
      thumb.setAttribute("data-id", w.id);
      thumb.classList.add(w.cls);

      const label = document.createElement("div");
      label.className = "wp-thumb-label";
      label.textContent = w.name;
      thumb.appendChild(label);

      const check = document.createElement("div");
      check.className = "wp-check";
      check.textContent = "✓";
      thumb.appendChild(check);

      thumb.addEventListener("click", () => {
        this.manager.set(w.id);
        this._syncSelection();
      });

      grid.appendChild(thumb);
    });

    this.picker.appendChild(grid);
    this.pickerEl = this.picker;
    document.body.appendChild(this.picker);
  }

  /* (Re)synchronize the "selected" highlight across thumbnails. */
  _syncSelection() {
    this.grid.querySelectorAll(".wp-thumbnail").forEach((t) => {
      t.classList.toggle("selected", t.getAttribute("data-id") === this.manager.current);
      const check = t.querySelector(".wp-check");
      if (check) check.style.display =
        t.getAttribute("data-id") === this.manager.current ? "flex" : "none";
    });
  }

  _setupEvents() {
    // Right-click on empty desktop opens the context menu.
    this.desktop.addEventListener("contextmenu", (e) => {
      const icon = e.target.closest(".desktop-icon");
      if (icon) return; // don't shadow icon behaviour
      e.preventDefault();
      this.showMenu(e.clientX, e.clientY);
    });

    // Dismiss menu/picker when clicking anywhere else.
    document.addEventListener("click", (e) => {
      if (this.menuEl.contains(e.target)) return;
      this.hideMenu();
      if (this.pickerEl.contains(e.target)) return;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.hideMenu();
        this.hidePicker();
      }
    });
  }

  showMenu(x, y) {
    this.hidePicker();
    this.menuEl.classList.add("open");
    const rect = this.menuEl.getBoundingClientRect();
    const xClamp = Math.min(x, window.innerWidth - rect.width - 8);
    const yClamp = Math.min(y, window.innerHeight - rect.height - 8);
    this.menuEl.style.left = Math.max(4, xClamp) + "px";
    this.menuEl.style.top = Math.max(4, yClamp) + "px";
  }

  hideMenu() {
    this.menuEl.classList.remove("open");
  }

  showPicker() {
    this._syncSelection();
    this.pickerEl.classList.add("open");
    const rect = this.pickerEl.getBoundingClientRect();
    this.pickerEl.style.left = "50%";
    this.pickerEl.style.transform = "translateX(-50%)";
  }

  hidePicker() {
    this.pickerEl.classList.remove("open");
  }
}

/* ------------------------------------------------------------------ *
 * Calculator (Ticket 3)
 *
 * Standard calculator with immediate-execution semantics (no operator
 * precedence): operations are evaluated as they are entered. Supports
 * digits, + − × ÷, decimal, %, ±, C and =, plus keyboard input.
 * Divide-by-zero yields an "Error" state that clears on the next input.
 * ------------------------------------------------------------------ */

class Calculator {
  constructor(root) {
    this.root = root;
    this.clear();
    this._build();
    this._onKeyDown = this._onKeyDown.bind(this);
    document.addEventListener("keydown", this._onKeyDown);
    this.update();
  }

  /* Reset all state to the initial "0" display. */
  clear() {
    this.current = "0";        // string currently shown / being typed
    this.previous = null;      // stored left operand (string)
    this.operator = null;      // one of + − × ÷ or null
    this.shouldReset = false;  // next digit starts a fresh entry
    this.error = false;        // divide-by-zero state
  }

  /* Build the display + key buttons inside the given root. */
  _build() {
    this.root.className = "calc";
    this.root.innerHTML =
      `<div class="calc-display">
         <div class="calc-prev"></div>
         <div class="calc-current"></div>
       </div>
       <div class="calc-keys"></div>`;
    this.displayPrev = this.root.querySelector(".calc-prev");
    this.displayCur = this.root.querySelector(".calc-current");
    this.keysEl = this.root.querySelector(".calc-keys");
    this._renderKeys();
  }

  /* Lay out the keypad. Layout rows: controls, then digit grid. */
  _renderKeys() {
    const layout = [
      ["C", "ctrl"], ["±", "ctrl"], ["%", "ctrl"], ["÷", "op"],
      ["7", "num"], ["8", "num"], ["9", "num"], ["×", "op"],
      ["4", "num"], ["5", "num"], ["6", "num"], ["−", "op"],
      ["1", "num"], ["2", "num"], ["3", "num"], ["+", "op"],
      ["0", "num wide"], [".", "dot"], ["=", "equals"],
    ];
    layout.forEach(([label, cls]) => {
      const btn = document.createElement("button");
      btn.className = "calc-key " + cls;
      btn.textContent = label;
      btn.setAttribute("type", "button");
      btn.addEventListener("click", () => this._onKey(label));
      this.keysEl.appendChild(btn);
    });
  }

  /* Handle a physical key press (button click or keyboard). */
  _onKey(label) {
    if (this.error && /[0-9.]/.test(label)) this.clear();
    switch (label) {
      case "C": return this.clear();
      case "±": return this.sign();
      case "%": return this.percent();
      case ".": return this.decimal();
      case "=": return this.equals();
      case "+": case "−": case "×": case "÷": return this.chooseOperator(label);
      default:
        if (/^[0-9]$/.test(label)) return this.digit(label);
    }
  }

  /* Append a digit, replacing the entry after an operator. */
  digit(d) {
    if (this.shouldReset || this.current === "0") {
      this.current = d;
      this.shouldReset = false;
    } else {
      this.current += d;
    }
    this.update();
  }

  /* Insert a decimal point if one is not already present. */
  decimal() {
    if (this.shouldReset) {
      this.current = "0.";
      this.shouldReset = false;
      this.update();
      return;
    }
    if (!this.current.includes(".")) this.current += ".";
    this.update();
  }

  /* Toggle the sign of the current entry. */
  sign() {
    if (this.current === "0" || this.error) return;
    this.current = this.current.startsWith("-")
      ? this.current.slice(1)
      : "-" + this.current;
    this.update();
  }

  /* Divide the current entry by 100. */
  percent() {
    const v = parseFloat(this.current);
    if (isNaN(v)) return;
    this.current = this._format(v / 100);
    this.update();
  }

  /* Store the current operand and operator, awaiting the next entry. */
  chooseOperator(op) {
    if (this.error) return;
    // If an operator is already pending and a new operand started,
    // evaluate the pending operation first (immediate execution) and
    // fold the result back into the running total.
    if (this.operator !== null && !this.shouldReset) {
      const result = this._compute();
      if (result === null) { // divide-by-zero
        this.error = true;
        this.current = "Error";
        this.operator = null;
        this.previous = null;
        this.shouldReset = true;
        this.update();
        return;
      }
      this.current = this._format(result);
    }
    this.previous = this.current;
    this.operator = op;
    this.shouldReset = true;
    this.update();
  }

  /* Evaluate the pending operation and show the result. */
  equals() {
    if (this.error) return;
    if (this.operator === null || this.previous === null) return;
    const result = this._compute();
    if (result === null) { // divide-by-zero
      this.error = true;
      this.current = "Error";
      this.operator = null;
      this.previous = null;
      this.shouldReset = true;
      this.update();
      return;
    }
    this.current = this._format(result);
    this.operator = null;
    this.previous = null;
    this.shouldReset = true;
    this.update();
  }

  /* Perform the pending binary operation. Returns null on divide-by-zero. */
  _compute() {
    const a = parseFloat(this.previous);
    const b = parseFloat(this.current);
    if (isNaN(a) || isNaN(b)) return null;
    let r;
    switch (this.operator) {
      case "+": r = a + b; break;
      case "−": r = a - b; break;
      case "×": r = a * b; break;
      case "÷":
        if (b === 0) return null;
        r = a / b; break;
      default: return null;
    }
    return r;
  }

  /* Delete the last digit of the current entry (Backspace). */
  backspace() {
    if (this.error || this.shouldReset) {
      this.clear();
      this.update();
      return;
    }
    this.current = this.current.slice(0, -1) || "0";
    this.update();
  }

  /* Format a number for display, trimming floating-point noise. */
  _format(n) {
    if (isNaN(n) || !isFinite(n)) return "Error";
    return String(parseFloat(n.toPrecision(12)));
  }

  /* Redraw the display from current state. */
  update() {
    if (this.error) {
      this.displayCur.textContent = "Error";
      this.displayPrev.textContent = "";
      return;
    }
    this.displayCur.textContent = this.current;
    if (this.operator !== null && this.previous !== null) {
      this.displayPrev.textContent = this.previous + " " + this.operator;
    } else {
      this.displayPrev.textContent = "";
    }
  }

  /* Keyboard support: digits, + - * /, ., %, Enter, Escape, Backspace. */
  _onKeyDown(e) {
    // Ignore when focus is inside another app (textarea, etc.).
    if (e.target && (e.target.tagName === "TEXTAREA" || e.target.tagName === "INPUT")) return;
    const k = e.key;
    if (/^[0-9]$/.test(k)) { this._onKey(k); e.preventDefault(); }
    else if (k === "+") { this._onKey("+"); e.preventDefault(); }
    else if (k === "-") { this._onKey("−"); e.preventDefault(); }
    else if (k === "*") { this._onKey("×"); e.preventDefault(); }
    else if (k === "/") { this._onKey("÷"); e.preventDefault(); }
    else if (k === "." || k === ",") { this._onKey("."); e.preventDefault(); }
    else if (k === "%") { this._onKey("%"); e.preventDefault(); }
    else if (k === "Enter" || k === "=") { this._onKey("="); e.preventDefault(); }
    else if (k === "Escape") { this._onKey("C"); e.preventDefault(); }
    else if (k === "Backspace") { this.backspace(); e.preventDefault(); }
  }

  /* Remove the keyboard listener when the window is closed. */
  destroy() {
    document.removeEventListener("keydown", this._onKeyDown);
  }
}

/* Build the calculator app content. Returns { el, instance } so the
 * WindowManager can tear the instance down when the window closes. */
function buildCalculator() {
  const el = document.createElement("div");
  const calc = new Calculator(el);
  return { el, instance: calc };
}

/* ------------------------------------------------------------------ *
 * Notepad (Ticket 4)
 *
 * Multiple named documents persisted in localStorage. A sidebar lists
 * all saved documents; clicking one opens it for editing. Actions:
 * New (prompt for name or "Untitled N"), Save, Delete (with confirm).
 * The current document name is reflected in the window title bar.
 * ------------------------------------------------------------------ */

const NOTEPAD_STORAGE_KEY = "browseros.notepad.docs";

class Notepad {
  constructor(root, titleEl) {
    this.root = root;
    this.titleEl = titleEl;
    this.docs = [];
    this.currentId = null;
    this.nextUntitled = 1;
    this._load();
    this._build();
    this._onInput = this._onInput.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    // Auto-select the most recent document if none was active.
    if (!this.currentId && this.docs.length) {
      this.currentId = this.docs
        .slice()
        .sort((a, b) => (b.modified || 0) - (a.modified || 0))[0].id;
    }
    this.selectDoc(this.currentId);
  }

  /* Load documents from localStorage (tolerant of bad data). */
  _load() {
    try {
      const raw = localStorage.getItem(NOTEPAD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.docs = parsed.filter(
            (d) => d && typeof d.id === "string" && typeof d.name === "string"
          );
        }
      }
    } catch (e) {
      /* ignore corrupt storage */
    }
    // Compute the next "Untitled N" number from existing docs.
    this.nextUntitled = 1;
    for (const d of this.docs) {
      if (d.name.startsWith("Untitled ")) {
        const n = parseInt(d.name.slice("Untitled ".length), 10);
        if (!isNaN(n) && n >= this.nextUntitled) this.nextUntitled = n + 1;
      }
    }
  }

  /* Persist documents to localStorage. */
  _save() {
    try {
      localStorage.setItem(NOTEPAD_STORAGE_KEY, JSON.stringify(this.docs));
    } catch (e) {
      /* ignore storage errors */
    }
  }

  /* Build the sidebar + textarea inside the given root. */
  _build() {
    this.root.className = "notepad";
    this.root.innerHTML =
      '<div class="notepad-sidebar">' +
        '<div class="notepad-actions"></div>' +
        '<div class="notepad-docs-title">Documents</div>' +
        '<div class="notepad-docs"></div>' +
      '</div>' +
      '<div class="notepad-main">' +
        '<textarea class="notepad-textarea" id="notepad-textarea" spellcheck="false"></textarea>' +
      '</div>';

    const actions = this.root.querySelector(".notepad-actions");
    this.docsList = this.root.querySelector(".notepad-docs");
    this.textarea = this.root.querySelector(".notepad-textarea");

    this._buildAction("＋ New", "new", "primary", "＋", () => this.newDoc());
    this._buildAction("Save", "save", "", "💾", () => this.saveCurrent());
    this._buildAction("Delete", "delete", "danger", "🗑", () => this.deleteCurrent());

    this.textarea.addEventListener("input", this._onInput);
    this.textarea.addEventListener("keydown", this._onKeyDown);
    this.renderSidebar();
  }

  _buildAction(label, type, extraCls, icon, handler) {
    const btn = document.createElement("button");
    btn.className = "notepad-action " + extraCls;
    btn.setAttribute("data-action", type);
    btn.innerHTML = '<span class="doc-icon">' + icon + "</span>" + label;
    btn.addEventListener("click", handler);
    this.root.querySelector(".notepad-actions").appendChild(btn);
    if (type === "delete") this.deleteBtn = btn;
    else if (type === "save") this.saveBtn = btn;
  }

  /* Redraw the document list and sync the active highlight. */
  renderSidebar() {
    const list = this.docsList;
    list.innerHTML = "";
    if (this.docs.length === 0) {
      const empty = document.createElement("div");
      empty.className = "notepad-empty";
      empty.textContent = "No documents yet. Click “New” to create one.";
      list.appendChild(empty);
      this._syncActions();
      return;
    }
    // Newest modified first.
    const sorted = this.docs
      .slice()
      .sort((a, b) => (b.modified || 0) - (a.modified || 0));
    sorted.forEach((doc) => {
      const item = document.createElement("div");
      item.className = "notepad-doc";
      if (doc.id === this.currentId) item.classList.add("active");
      item.setAttribute("data-id", doc.id);
      item.innerHTML =
        '<span class="doc-icon">📄</span>' +
        '<span class="doc-name"></span>';
      item.querySelector(".doc-name").textContent = doc.name;
      item.addEventListener("click", () => this.selectDoc(doc.id));
      list.appendChild(item);
    });
    this._syncActions();
  }

  /* Enable/disable actions based on whether a document is active. */
  _syncActions() {
    const hasCurrent = this.currentId !== null;
    if (this.saveBtn) this.saveBtn.disabled = !hasCurrent;
    if (this.deleteBtn) this.deleteBtn.disabled = !hasCurrent;
  }

  /* Update the window title bar with the active document name. */
  _updateTitle() {
    if (this.titleEl) {
      this.titleEl.textContent = this.currentId
        ? "Notepad — " + this._currentDoc().name
        : "Notepad";
    }
  }

  /* Current document name for the title bar. */
  getTitle() {
    return this.currentId
      ? "Notepad — " + this._currentDoc().name
      : "Notepad";
  }

  _currentDoc() {
    return this.docs.find((d) => d.id === this.currentId) || null;
  }

  /* Create a new document, prompting for a name (or "Untitled N"). */
  newDoc() {
    const name = prompt("Document name:", "Untitled " + this.nextUntitled);
    if (name === null) return; // cancelled
    let displayName = name.trim();
    if (!displayName) displayName = "Untitled " + this.nextUntitled;
    // Avoid duplicate names among existing docs.
    const taken = this.docs.some((d) => d.name === displayName);
    if (taken) displayName = displayName + " (copy)";
    const doc = {
      id: "doc_" + Date.now() + "_" + Math.floor(Math.random() * 1000),
      name: displayName,
      content: "",
      modified: Date.now(),
    };
    this.docs.push(doc);
    this._save();
    this.selectDoc(doc.id);
    this.renderSidebar();
  }

  /* Persist the active document's current content to storage. */
  saveCurrent() {
    const doc = this._currentDoc();
    if (!doc) return;
    doc.content = this.textarea.value;
    doc.modified = Date.now();
    this._save();
    this.renderSidebar();
  }

  /* Delete the active document after confirmation. */
  deleteCurrent() {
    const doc = this._currentDoc();
    if (!doc) return;
    if (!confirm('Delete "' + doc.name + '"? This cannot be undone.')) return;
    this.docs = this.docs.filter((d) => d.id !== doc.id);
    this._save();
    if (this.currentId === doc.id) {
      this.currentId = this.docs.length ? this.docs[0].id : null;
    }
    this.selectDoc(this.currentId);
    this.renderSidebar();
  }

  /* Open a document for editing (or clear the editor if null). */
  selectDoc(id) {
    // Flush edits from the previously active doc into its object.
    const prevId = this.currentId;
    if (prevId && prevId !== id) {
      const prev = this.docs.find((d) => d.id === prevId);
      if (prev) {
        prev.content = this.textarea.value;
        prev.modified = Date.now();
      }
    }
    this.currentId = id;
    const doc = this._currentDoc();
    this.textarea.value = doc ? doc.content || "" : "";
    this._updateTitle();
    this._syncActions();
  }

  /* Handle text input: keep the doc's content in sync in memory. */
  _onInput() {
    const doc = this._currentDoc();
    if (doc) {
      doc.content = this.textarea.value;
      doc.modified = Date.now();
    }
  }

  /* Ctrl/Cmd+S saves the current document. */
  _onKeyDown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      this.saveCurrent();
    }
  }

  /* Remove listeners on teardown. */
  destroy() {
    this.saveCurrent();
  }
}

/* Build the Notepad app content. Passes the window title element so the
 * app can reflect the active document name in the title bar. */
function buildNotepad(titleEl) {
  const el = document.createElement("div");
  const np = new Notepad(el, titleEl);
  return { el, instance: np };
}

/* ------------------------------------------------------------------ *
 * Minesweeper (Ticket 5)
 *
 * Three difficulties (9×9/10, 16×16/40, 16×30/99). Mines are placed
 * after the first click; the clicked cell and its neighbours are always
 * safe. Left click reveals (flood filling zero cells), right click
 * toggles a flag. Mine counter and timer start on first click. Win when
 * every non-mine cell is revealed; lose when a mine is revealed.
 * ------------------------------------------------------------------ */

class Minesweeper {
  constructor(root) {
    this.root = root;
    this.boardEl = null;
    this._grid = null;
    this._cells = null; // flat array of cell DOM nodes
    this.currentDiff = "beginner";
    this.rows = 9;
    this.cols = 9;
    this.mineCount = 10;
    this.cellSize = 30;
    this.minesPlaced = false;
    this.gameOver = false;
    this.won = false;
    this.flags = 0;
    this.revealed = 0;
    this.timer = 0;
    this._timerInterval = null;
    this._timerStart = 0;
    this._diff = this._diff.bind(this);
    this._onReveal = this._onReveal.bind(this);
    this._onFlag = this._onFlag.bind(this);
    this._onRestart = this._onRestart.bind(this);
    this._build();
    this.newGame();
  }

  /* Difficulty presets: rows, cols, mines, label, cell size (px). */
  _diff() {
    return {
      beginner: { rows: 9, cols: 9, mines: 10, label: "Beginner", cell: 30 },
      intermediate: { rows: 16, cols: 16, mines: 40, label: "Intermediate", cell: 26 },
      expert: { rows: 16, cols: 30, mines: 99, label: "Expert", cell: 20 },
    };
  }

  /* Build the control bar, status row and board container. */
  _build() {
    this.root.className = "minesweeper";
    this.root.innerHTML =
      '<div class="minesweeper-title">Minesweeper</div>' +
      '<div class="ms-control"></div>' +
      '<div class="ms-status">' +
        '<div class="ms-mines">000</div>' +
        '<div class="ms-timer">000</div>' +
      '</div>' +
      '<div class="ms-board"><div class="ms-grid"></div></div>';

    this.controlEl = this.root.querySelector(".ms-control");
    this.minesEl = this.root.querySelector(".ms-mines");
    this.timerEl = this.root.querySelector(".ms-timer");
    this.boardEl = this.root.querySelector(".ms-board");
    this._grid = this.root.querySelector(".ms-grid");

    const diffs = Object.keys(this._diff());
    diffs.forEach((key) => {
      const btn = document.createElement("button");
      btn.className = "ms-diff";
      btn.setAttribute("data-diff", key);
      btn.textContent = this._diff()[key].label;
      btn.addEventListener("click", () => this.setDifficulty(key));
      this.controlEl.appendChild(btn);
    });

    const restart = document.createElement("button");
    restart.className = "ms-restart";
    restart.setAttribute("title", "New game");
    restart.textContent = "🙂";
    restart.addEventListener("click", this._onRestart);
    this.controlEl.appendChild(restart);
    this.restartEl = restart;
  }

  /* Switch difficulty and start a fresh game. */
  setDifficulty(key) {
    const diffs = this._diff();
    if (!diffs[key]) return;
    this.currentDiff = key;
    this.root.querySelectorAll(".ms-diff").forEach((b) =>
      b.classList.toggle("active", b.getAttribute("data-diff") === key)
    );
    this.newGame();
  }

  /* Reset the board and start a new game at the current difficulty. */
  newGame() {
    this._stopTimer();
    const cfg = this._diff()[this.currentDiff];
    this.rows = cfg.rows;
    this.cols = cfg.cols;
    this.mineCount = cfg.mines;
    this.cellSize = cfg.cell;

    this.minesPlaced = false;
    this.gameOver = false;
    this.won = false;
    this.flags = 0;
    this.revealed = 0;
    this.timer = 0;

    // Build the cell data model.
    this.board = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        row.push({ row: r, col: c, mine: false, revealed: false, flagged: false, adjacent: 0 });
      }
      this.board.push(row);
    }

    this._buildBoardDOM();
    this._render();
    this.restartEl.textContent = "🙂";
    this._setResult(null);
  }

  /* Build the grid DOM for the current board size. */
  _buildBoardDOM() {
    this._grid.innerHTML = "";
    this._grid.style.setProperty("--ms-cell", this.cellSize + "px");
    this._grid.style.gridTemplateColumns = `repeat(${this.cols}, var(--ms-cell))`;
    this._cells = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const btn = document.createElement("button");
        btn.className = "ms-cell";
        btn.setAttribute("type", "button");
        btn.setAttribute("data-row", r);
        btn.setAttribute("data-col", c);
        btn.addEventListener("click", this._onReveal);
        btn.addEventListener("contextmenu", this._onFlag);
        this._grid.appendChild(btn);
        this._cells.push(btn);
      }
    }
  }

  /* All neighbour coordinates (in-bounds only). */
  _neighbors(r, c) {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const nr = r + dr;
        const nc = c + dc;
        if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
          out.push([nr, nc]);
        }
      }
    }
    return out;
  }

  /* DOM node for a cell. */
  _cellEl(r, c) {
    return this._cells[r * this.cols + c];
  }

  /* Left click: reveal a cell. */
  _onReveal(e) {
    const r = parseInt(e.currentTarget.getAttribute("data-row"), 10);
    const c = parseInt(e.currentTarget.getAttribute("data-col"), 10);
    this.reveal(r, c);
  }

  /* Right click: toggle a flag. */
  _onFlag(e) {
    e.preventDefault();
    const r = parseInt(e.currentTarget.getAttribute("data-row"), 10);
    const c = parseInt(e.currentTarget.getAttribute("data-col"), 10);
    this.toggleFlag(r, c);
  }

  /* Reveal a cell, placing mines on the first click and flood filling. */
  reveal(r, c) {
    if (this.gameOver) return;
    const cell = this.board[r][c];
    if (cell.revealed || cell.flagged) return;

    // First click: place mines avoiding this cell and its neighbours,
    // then start the timer.
    if (!this.minesPlaced) {
      this._placeMines(r, c);
      this.minesPlaced = true;
      this._startTimer();
    }

    if (cell.mine) {
      this._lose(r, c);
      return;
    }

    this._floodReveal(r, c);
    this._checkWin();
  }

  /* Scatter mines so the safe cell and its neighbours never contain one. */
  _placeMines(safeR, safeC) {
    const safe = new Set();
    safe.add(safeR + "," + safeC);
    for (const [nr, nc] of this._neighbors(safeR, safeC)) {
      safe.add(nr + "," + nc);
    }

    const candidates = [];
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (!safe.has(r + "," + c)) candidates.push([r, c]);
      }
    }

    // Shuffle and mark the first `mines` cells as mines.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    const n = Math.min(this.mineCount, candidates.length);
    for (let i = 0; i < n; i++) {
      this.board[candidates[i][0]][candidates[i][1]].mine = true;
    }

    // Precompute adjacency counts.
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        if (this.board[r][c].mine) continue;
        let count = 0;
        for (const [nr, nc] of this._neighbors(r, c)) {
          if (this.board[nr][nc].mine) count++;
        }
        this.board[r][c].adjacent = count;
      }
    }
  }

  /* Reveal a cell and flood-fill zero cells. */
  revealCell(r, c) {
    const cell = this.board[r][c];
    if (cell.revealed || cell.flagged || cell.mine) return;
    cell.revealed = true;
    this.revealed++;
    if (cell.adjacent === 0) {
      const stack = this._neighbors(r, c);
      while (stack.length) {
        const [nr, nc] = stack.pop();
        const ncell = this.board[nr][nc];
        if (ncell.revealed || ncell.flagged || ncell.mine) continue;
        ncell.revealed = true;
        this.revealed++;
        if (ncell.adjacent === 0) {
          for (const [tr, tc] of this._neighbors(nr, nc)) stack.push([tr, tc]);
        }
      }
    }
  }

  /* Toggle flag on a cell. */
  toggleFlag(r, c) {
    if (this.gameOver) return;
    if (this.minesPlaced && this.board[r][c].revealed) return;
    const cell = this.board[r][c];
    cell.flagged = !cell.flagged;
    this.flags += cell.flagged ? 1 : -1;
    this._render();
  }

  /* Flood-fill reveal from a zero cell (used on first reveal). */
  _floodReveal(r, c) {
    this.revealCell(r, c);
  }

  /* Determine whether every non-mine cell has been revealed. */
  _checkWin() {
    const total = this.rows * this.cols;
    if (this.revealed === total - this.mineCount) {
      this._win();
    }
  }

  /* Loss: reveal all mines, lock the board, stop the timer. */
  _lose(r, c) {
    this.gameOver = true;
    this.won = false;
    this._stopTimer();
    this.restartEl.textContent = "😵";
    // Reveal every mine on loss (the triggering mine is shown too).
    for (let rr = 0; rr < this.rows; rr++) {
      for (let cc = 0; cc < this.cols; cc++) {
        const cell = this.board[rr][cc];
        if (cell.mine) {
          cell.revealed = true;
        }
      }
    }
    this._render();
    this._setResult(false);
  }

  /* Win: flag all remaining mines, stop the timer. */
  _win() {
    this.gameOver = true;
    this.won = true;
    this._stopTimer();
    this.restartEl.textContent = "😎";
    // Flag every unrevealed mine.
    for (let rr = 0; rr < this.rows; rr++) {
      for (let cc = 0; cc < this.cols; cc++) {
        const cell = this.board[rr][cc];
        if (cell.mine && !cell.flagged) {
          cell.flagged = true;
          this.flags++;
        }
      }
    }
    this._render();
    this._setResult(true);
  }

  /* Show a small win/lose hint under the board. */
  _setResult(isWin) {
    this.root.querySelectorAll(".ms-result").forEach((n) => n.remove());
    if (isWin === null) return;
    const el = document.createElement("div");
    el.className = "ms-result " + (isWin ? "win" : "lose");
    el.textContent = isWin ? "You win!" : "Game over — mine detonated.";
    this.boardEl.parentElement.insertBefore(el, this.boardEl.nextSibling);
  }

  /* Start the in-game timer. */
  _startTimer() {
    this._stopTimer();
    this._timerStart = Date.now();
    this._timerInterval = setInterval(() => {
      this.timer = Math.floor((Date.now() - this._timerStart) / 1000);
      this.timerEl.textContent = this._fmt(this.timer);
    }, 250);
  }

  /* Stop the timer. */
  _stopTimer() {
    if (this._timerInterval) {
      clearInterval(this._timerInterval);
      this._timerInterval = null;
    }
  }

  /* Format seconds as zero-padded 3 digits (e.g. 007). */
  _fmt(n) {
    const s = Math.max(0, Math.min(999, n));
    return String(s).padStart(3, "0");
  }

  /* Restart button handler. */
  _onRestart() {
    this.newGame();
  }

  /* Render the whole board from the data model. */
  _render() {
    const flagsLeft = this.mineCount - this.flags;
    this.minesEl.textContent = this._fmt(flagsLeft);
    this.timerEl.textContent = this._fmt(this.timer);

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = this.board[r][c];
        const el = this._cellEl(r, c);
        el.className = "ms-cell";
        el.textContent = "";

        if (cell.flagged && !cell.revealed) {
          el.classList.add("flagged");
          el.textContent = "🚩";
          continue;
        }
        if (!cell.revealed) continue;

        el.classList.add("revealed");
        if (cell.mine) {
          el.classList.add("mine");
          el.textContent = "💣";
        } else if (cell.flagged) {
          // A wrongly flagged cell shown on loss: mark with an X.
          el.classList.add("wrong");
          el.textContent = "✗";
        } else if (cell.adjacent > 0) {
          el.classList.add("n" + cell.adjacent);
          el.textContent = cell.adjacent;
        }
      }
    }
  }

  /* Remove listeners on teardown. */
  destroy() {
    this._stopTimer();
  }

  /* ---- Testing / inspection helpers (exposed on window) ---- */

  /* Serializable snapshot of the current game state. */
  getState() {
    return {
      difficulty: this.currentDiff,
      rows: this.rows,
      cols: this.cols,
      mineCount: this.mineCount,
      minesPlaced: this.minesPlaced,
      gameOver: this.gameOver,
      won: this.won,
      flags: this.flags,
      revealed: this.revealed,
      timer: this.timer,
      board: this.board.map((row) => row.map((c) => ({
        mine: c.mine,
        revealed: c.revealed,
        flagged: c.flagged,
        adjacent: c.adjacent,
      }))),
    };
  }

  /* Programmatic reveal (steppable API for inspection/testing). */
  stepReveal(r, c) {
    this.reveal(r, c);
  }

  /* Programmatic flag toggle (steppable API for inspection/testing). */
  stepFlag(r, c) {
    this.toggleFlag(r, c);
  }
}

/* Build the Minesweeper app content. */
function buildMinesweeper() {
  const el = document.createElement("div");
  const ms = new Minesweeper(el);
  return { el, instance: ms };
}

/* ------------------------------------------------------------------ *
 * Spider Solitaire (Ticket 6)
 *
 * One suit, 104 cards (two decks). Standard 10-column tableau: 4
 * columns of 6 cards and 6 columns of 5 (54 cards), the top card of
 * each column face up; the remaining 50 cards form the stock (dealt in
 * 5 rows of 10). Descending same-suit sequences move as a group; any
 * card or sequence may go on an empty column. A card/sequence is placed
 * on a card of the next higher rank. Newly exposed face-down cards flip
 * automatically. Clicking the stock deals one card to each column (only
 * when no column is empty). A complete King-to-Ace run (13 cards) is
 * removed automatically; the game is won when all 8 runs are removed.
 *
 * Data model: every column is an array of cards with index 0 = the
 * bottom of the pile and the last index = the top (interactive) card.
 * Cards have { rank: 1..13, faceUp: bool }. All cards share one suit.
 * ------------------------------------------------------------------ */

const SPIDER_SUIT = "\u2660"; // spades
const SPIDER_RANK_LABELS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

class Spider {
  constructor(root) {
    this.root = root;
    this.drag = null;
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onStockClick = this._onStockClick.bind(this);
    this._build();
    this.newGame();
  }

  /* Start a fresh game: build, shuffle and deal the deck. */
  newGame() {
    const deck = [];
    // One suit across two decks: 8 copies of each of the 13 ranks = 104 cards.
    for (let rank = 1; rank <= 13; rank++) {
      for (let copy = 0; copy < 8; copy++) {
        deck.push({ rank: rank, faceUp: false });
      }
    }
    // Fisher-Yates shuffle.
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    this.columns = [];
    for (let c = 0; c < 10; c++) this.columns.push([]);

    // Deal 54 tableau cards: first 4 columns get 6, remaining 6 get 5.
    let idx = 0;
    for (let c = 0; c < 10; c++) {
      const count = c < 4 ? 6 : 5;
      for (let k = 0; k < count; k++) {
        const card = deck[idx++];
        this.columns[c].push(card);
      }
    }
    // Only the top card of each column starts face up.
    for (let c = 0; c < 10; c++) {
      this.columns[c][this.columns[c].length - 1].faceUp = true;
    }

    // Remaining 50 cards form the stock (5 deals of 10).
    this.stock = deck.slice(idx);
    this.dealsLeft = this.stock.length / 10;

    this.won = false;
    this.removedRuns = 0;
    this._render();
  }

  /* Build the header, tableau, stock area and win banner. */
  _build() {
    this.root.className = "spider";
    this.root.innerHTML =
      '<div class="spider-header">' +
        '<button type="button" class="spider-new">\u21bb New Game</button>' +
        '<button type="button" class="spider-stock-btn">' +
          '<span class="spider-stock-dots">' +
            '<span class="spider-stock-dot"></span><span class="spider-stock-dot"></span>' +
            '<span class="spider-stock-dot"></span><span class="spider-stock-dot"></span>' +
            '<span class="spider-stock-dot"></span>' +
          '</span>Stock</button>' +
        '<span class="spider-stock-hint">Drag cards; click Stock to deal a row</span>' +
      '</div>' +
      '<div class="spider-win"></div>' +
      '<div class="spider-tableau"></div>' +
      '<div class="spider-stock-area">' +
        '<div class="spider-stock-pile"></div>' +
        '<span class="spider-stock-label"></span>' +
      '</div>';

    this.tableauEl = this.root.querySelector(".spider-tableau");
    this.stockBtn = this.root.querySelector(".spider-stock-btn");
    this.stockPile = this.root.querySelector(".spider-stock-pile");
    this.stockLabel = this.root.querySelector(".spider-stock-label");
    this.winEl = this.root.querySelector(".spider-win");

    this.stockBtn.addEventListener("click", this._onStockClick);
    this.stockPile.addEventListener("click", this._onStockClick);
    this.root.querySelector(".spider-new").addEventListener("click", () => this.newGame());
    this.root.addEventListener("mousedown", this._onMouseDown);
  }

  /* Click the stock: deal one card to each column (if allowed). */
  _onStockClick() {
    this.dealFromStock();
  }

  /* Deal one card onto the top of every column. */
  dealFromStock() {
    if (this.won) return;
    if (this.dealsLeft <= 0) return;
    // Can only deal when no column is empty.
    if (this.columns.some((c) => c.length === 0)) return;
    for (let c = 0; c < 10; c++) {
      const card = this.stock.pop();
      card.faceUp = true;
      this.columns[c].push(card);
    }
    this.dealsLeft--;
    this._render();
    this._checkRuns();
  }

  /* The data index of the top-most card of the moveable run in a column.
   * The run starts at the top (last index) and extends down while each
   * card is face up and exactly one rank lower than the one above it. */
  _groupStart(colIndex) {
    const col = this.columns[colIndex];
    if (!col.length) return -1;
    let s = col.length - 1;
    while (s > 0) {
      const cur = col[s];
      const below = col[s - 1];
      if (below.faceUp && below.rank === cur.rank + 1) {
        s--;
      } else {
        break;
      }
    }
    return s;
  }

  /* The rank of the top (interactive) card of a column. */
  _topRank(colIndex) {
    const col = this.columns[colIndex];
    return col.length ? col[col.length - 1].rank : 0;
  }

  /* Flip the newly exposed top card of a column up, if needed. */
  _flipTop(colIndex) {
    const col = this.columns[colIndex];
    const top = col[col.length - 1];
    if (top && !top.faceUp) top.faceUp = true;
  }

  /* Validate moving the run from `fromCol` onto `toCol`. The card that
   rests on the target is the *bottom* card of the moved run (its highest-
   rank card), so the target's top card must be one rank lower. */
  _canMove(fromCol, toCol) {
    if (fromCol === toCol) return false;
    const target = this.columns[toCol];
    if (target.length === 0) return true; // empty column accepts anything
    const groupBottom = this.columns[fromCol][this._groupStart(fromCol)].rank;
    return target[target.length - 1].rank === groupBottom + 1;
  }

  /* Move the detected run from one column to another and settle. */
  moveGroup(fromCol, toCol) {
    if (!this._canMove(fromCol, toCol)) return false;
    const start = this._groupStart(fromCol);
    const group = this.columns[fromCol].splice(start);
    this.columns[toCol].push(...group);
    this._flipTop(fromCol);
    this._render();
    this._checkRuns();
    return true;
  }

  /* Auto-remove completed King-to-Ace runs; re-render and check win. */
  _checkRuns() {
    let removed = true;
    while (removed) {
      removed = false;
      for (let c = 0; c < 10; c++) {
        const col = this.columns[c];
        if (col.length < 13) continue;
        // The top 13 cards must form a King-to-Ace run: the top (interactive)
        // card is an Ace (rank 1) and the rank rises by one going down the pile
        // to a King (rank 13) at the bottom of the run.
        let ok = true;
        for (let k = 0; k < 13; k++) {
          const card = col[col.length - 1 - k];
          if (!card.faceUp || card.rank !== k + 1) {
            ok = false;
            break;
          }
        }
        if (ok) {
          col.splice(col.length - 13, 13);
          this.removedRuns++;
          this._flipTop(c);
          removed = true;
          break;
        }
      }
    }
    this._render();
    this._checkWin();
  }

  /* Win when the stock is exhausted and the tableau is empty. */
  _checkWin() {
    if (this.dealsLeft === 0 && this.stock.length === 0 &&
        this.columns.every((c) => c.length === 0)) {
      this.won = true;
    }
    this._render();
  }

  /* Create a single card DOM node (face up or down). `index` is the card's
   position within its column (0 = bottom of pile), used for drag handling. */
  _makeCard(card, index) {
    const el = document.createElement("div");
    el.className = "spider-card " + (card.faceUp ? "faceup" : "facedown");
    el.setAttribute("data-index", index);
    if (!card.faceUp) return el;
    const label = SPIDER_RANK_LABELS[card.rank - 1];
    el.innerHTML =
      '<div class="rank-top">' + label + SPIDER_SUIT + '</div>' +
      '<div class="suit-big">' + SPIDER_SUIT + '</div>' +
      '<div class="rank-bot">' + label + SPIDER_SUIT + '</div>';
    return el;
  }

  /* Redraw the whole game from state. */
  _render() {
    // Clear the tableau.
    this.tableauEl.innerHTML = "";

    for (let c = 0; c < 10; c++) {
      const col = this.columns[c];
      const colEl = document.createElement("div");
      colEl.className = "spider-col";
      colEl.setAttribute("data-col", c);

      if (col.length === 0) {
        const empty = document.createElement("div");
        empty.className = "spider-col-empty";
        empty.textContent = "\u2660";
        colEl.appendChild(empty);
      } else {
        col.forEach((card, i) => colEl.appendChild(this._makeCard(card, i)));
      }
      this.tableauEl.appendChild(colEl);
    }

    this._renderStock();
    this.winEl.classList.toggle("show", !!this.won);
    if (this.won) {
      this.winEl.textContent = "\u{1F3C6} You win! All 8 runs removed.";
    }
  }

  /* Render the stock pile + label. */
  _renderStock() {
    this.stockPile.innerHTML = "";
    const dots = Math.min(this.dealsLeft, 5);
    for (let i = 0; i < dots; i++) {
      const mini = document.createElement("div");
      mini.className = "spider-stock-card-mini";
      this.stockPile.appendChild(mini);
    }
    const cardsLeft = this.stock.length;
    this.stockLabel.textContent =
      "Stock: " + cardsLeft + " cards (" + this.dealsLeft + " rows)";
    this.stockBtn.disabled = !(this.dealsLeft > 0 &&
      this.columns.every((c) => c.length > 0));
  }

  /* ---------------------------------------------------------------- *
   * Drag and drop
   * ---------------------------------------------------------------- */

  _onMouseDown(e) {
    if (e.button !== 0) return;
    const cardEl = e.target.closest && e.target.closest(".spider-card");
    if (!cardEl) return;
    const colEl = cardEl.closest(".spider-col");
    if (!colEl) return;
    const colIndex = parseInt(colEl.getAttribute("data-col"), 10);
    const cardIndex = parseInt(cardEl.getAttribute("data-index"), 10);
    if (isNaN(colIndex) || isNaN(cardIndex)) return;

    const col = this.columns[colIndex];
    if (cardIndex < 0 || cardIndex >= col.length) return;
    if (!col[cardIndex].faceUp) return; // can only grab face-up cards

    const start = this._groupStart(colIndex);
    if (cardIndex < start) return; // not part of the moveable run

    this.drag = {
      fromCol: colIndex,
      start: start,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
    };

    const onMove = (ev) => {
      if (Math.abs(ev.clientX - this.drag.startX) + Math.abs(ev.clientY - this.drag.startY) > 5) {
        this.drag.moved = true;
      }
      if (!this.drag.layer) this._createDragLayer();
      this._positionDragLayer(ev.clientX, ev.clientY);
      this._highlightTarget(ev.clientX, ev.clientY);
    };

    const onUp = (ev) => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      this._clearHighlight();
      if (this.drag.layer) {
        this.drag.layer.remove();
        this.drag.layer = null;
      }
      // Hide the dragging cards from the source column while dragging.
      this._render();
      if (this.drag && this.drag.moved) {
        const toCol = this._columnAt(ev.clientX, ev.clientY);
        if (toCol !== null && toCol !== this.drag.fromCol) {
          this.moveGroup(this.drag.fromCol, toCol);
        }
      }
      this.drag = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  /* Build a floating layer that visually carries the dragged run. */
  _createDragLayer() {
    const layer = document.createElement("div");
    layer.className = "spider-drag-layer";
    this.drag.layer = layer;
    document.body.appendChild(layer);

    const start = this.drag.start;
    const col = this.columns[this.drag.fromCol];
    for (let i = start; i <= col.length - 1; i++) {
      const cardEl = this._makeCard(col[i], i);
      cardEl.style.top = -((i - start) * 24) + "px";
      layer.appendChild(cardEl);
    }
  }

  /* Keep the floating layer under the cursor (offset a little). */
  _positionDragLayer(clientX, clientY) {
    if (!this.drag.layer) return;
    this.drag.layer.style.transform = "translate(" + (clientX + 14) + "px, " + (clientY + 14) + "px)";
  }

  /* Highlight the column the dragged cards would land on. */
  _highlightTarget(clientX, clientY) {
    this._clearHighlight();
    const toCol = this._columnAt(clientX, clientY);
    if (toCol === null || toCol === this.drag.fromCol) return;
    const colEl = this.tableauEl.querySelector('.spider-col[data-col="' + toCol + '"]');
    if (!colEl) return;
    colEl.classList.add(this._canMove(this.drag.fromCol, toCol) ? "drop-ok" : "");
  }

  _clearHighlight() {
    this.tableauEl.querySelectorAll(".spider-col.drop-ok").forEach((el) =>
      el.classList.remove("drop-ok")
    );
  }

  /* Find the column under a point, or null. */
  _columnAt(clientX, clientY) {
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return null;
    const colEl = target.closest && target.closest(".spider-col");
    if (!colEl) return null;
    const v = parseInt(colEl.getAttribute("data-col"), 10);
    return isNaN(v) ? null : v;
  }

  /* Remove listeners on teardown. */
  destroy() {
    this.root.removeEventListener("mousedown", this._onMouseDown);
  }

  /* ---------------------------------------------------------------- *
   * Testing / inspection helpers (exposed on window)
   * ---------------------------------------------------------------- */

  /* Serializable snapshot of the current game state. */
  getState() {
    return {
      dealsLeft: this.dealsLeft,
      stock: this.stock.length,
      removedRuns: this.removedRuns,
      won: this.won,
      columns: this.columns.map((c) => c.map((card) => ({ rank: card.rank, faceUp: card.faceUp }))),
    };
  }

  /* Programmatic stock deal (steppable API). */
  stepDeal() {
    this.dealFromStock();
  }

  /* Programmatic group move (steppable API). */
  stepMove(fromCol, toCol) {
    this.moveGroup(fromCol, toCol);
  }

  /* Programmatic new game (steppable API). */
  stepNew() {
    this.newGame();
  }
}

/* Build the Spider Solitaire app content. */
function buildSpider() {
  const el = document.createElement("div");
  const sp = new Spider(el);
  return { el, instance: sp };
}



/* ------------------------------------------------------------------ *
 * Init
 * ------------------------------------------------------------------ */

const wm = new WindowManager();

// Wallpaper manager + UI (Ticket 2).
const wallpaperManager = new WallpaperManager();
let wallpaperUI = null;

document.addEventListener("DOMContentLoaded", () => {
  renderDesktopIcons();
  startClock();
  setupDesktopInteraction();
  wallpaperUI = new WallpaperUI(wallpaperManager);
});

// Expose the window manager for debugging / testing in the browser.
window.__wm = wm;
window.APPS = APPS;
window.__wallpaper = wallpaperManager;
window.__wallpaperUI = () => wallpaperUI;
window.__getCalc = () => (wm.state.get("calculator") ? wm.state.get("calculator").el.__instance : null);
window.__getNotepad = () => (wm.state.get("notepad") ? wm.state.get("notepad").el.__instance : null);
window.__getMinesweeper = () => (wm.state.get("minesweeper") ? wm.state.get("minesweeper").el.__instance : null);
window.__getSpider = () => (wm.state.get("spider") ? wm.state.get("spider").el.__instance : null);
