/* ============================================================
   Browser OS — Main JavaScript
   ============================================================ */

// ============================================================
// SECTION 1: App Registry
// ============================================================

const APPS = {
  notepad: { name: "Notepad", icon: "📝", defaultWidth: 500, defaultHeight: 360 },
  calculator: { name: "Calculator", icon: "🧮", defaultWidth: 320, defaultHeight: 440 },
  minesweeper: { name: "Minesweeper", icon: "💣", defaultWidth: 500, defaultHeight: 500 },
  spider: { name: "Spider Solitaire", icon: "🕷️", defaultWidth: 860, defaultHeight: 560 },
};

// ============================================================
// SECTION 2: Desktop Shell
// ============================================================

/**
 * Create desktop icons for each app.
 */
function createDesktopIcons() {
  const container = document.getElementById("desktop-icons");
  for (const [appId, app] of Object.entries(APPS)) {
    const icon = document.createElement("div");
    icon.className = "desktop-icon";
    icon.dataset.app = appId;

    const iconEl = document.createElement("div");
    iconEl.className = "desktop-icon-icon";
    iconEl.textContent = app.icon;

    const label = document.createElement("div");
    label.className = "desktop-icon-label";
    label.textContent = app.name;

    icon.appendChild(iconEl);
    icon.appendChild(label);

    // Double-click to open
    icon.addEventListener("dblclick", () => handleDesktopIconDoubleClick(appId));

    container.appendChild(icon);
  }
}

/**
 * Handle double-click on a desktop icon: open or focus the app window.
 */
function handleDesktopIconDoubleClick(appId) {
  if (windowMap[appId]) {
    focusWindow(windowMap[appId]);
  } else {
    openWindow(appId);
  }
}

// ============================================================
// SECTION 3: Window Manager
// ============================================================

/**
 * Track z-order: highest number = frontmost.
 */
let currentZIndex = 100;

/**
 * Track focused window ID.
 */
let focusedWindowId = null;

/**
 * Map of appId -> windowId (for single-instance enforcement).
 */
const windowMap = {};

/**
 * Map of windowId -> appId.
 */
const appIdMap = {};

/**
 * Generate a unique window ID.
 */
let windowIdCounter = 0;
function generateWindowId() {
  return "window-" + (++windowIdCounter);
}

/**
 * Open a window for the given app. Returns the window DOM element.
 * If a window for this app already exists, focuses it instead.
 */
function openWindow(appId) {
  const app = APPS[appId];
  if (windowMap[appId]) {
    focusWindow(windowMap[appId]);
    return null;
  }

  const windowId = generateWindowId();
  const windowEl = createWindowElement(appId, app.name, "");

  // Position near top-left with slight offset
  const offset = (Object.keys(windowMap).length) * 30;
  windowEl.style.left = (80 + offset) + "px";
  windowEl.style.top = (40 + offset) + "px";
  windowEl.style.width = app.defaultWidth + "px";
  windowEl.style.height = app.defaultHeight + "px";

  document.getElementById("windows-container").appendChild(windowEl);

  // Update maps
  windowMap[appId] = windowId;
  appIdMap[windowId] = appId;

  focusWindow(windowId);
  updateTaskbar();

  // Init dragging and resizing
  const titleBar = windowEl.querySelector(".window-titlebar");
  initWindowDrag(windowEl, titleBar);
  initWindowResize(windowEl);

  // Initialize app-specific content
  if (appId === "calculator") {
    const content = windowEl.querySelector(".window-content");
    initCalculator(content, windowId);
  }

  if (appId === "notepad") {
    const content = windowEl.querySelector(".window-content");
    initNotepad(content, windowId);
  }

  if (appId === "minesweeper") {
    const content = windowEl.querySelector(".window-content");
    initMinesweeper(content, windowId);
  }

  if (appId === "spider") {
    const content = windowEl.querySelector(".window-content");
    initSpiderGame(content, windowId);
  }

  return windowEl;
}

/**
 * Create a window element and add it to the DOM.
 */
function createWindowElement(appId, title, extra) {
  const windowId = appIdMap[Object.keys(windowMap).find(k => windowMap[k] === appId) || ""] || generateWindowId();
  const app = APPS[appId];

  const el = document.createElement("div");
  el.className = "window";
  el.id = windowId;
  el.dataset.app = appId;

  // Title bar
  const titleBar = document.createElement("div");
  titleBar.className = "window-titlebar";

  const titleText = document.createElement("div");
  titleText.className = "window-title-text";
  let titleStr = title;
  if (extra) {
    titleStr += '<span class="window-extra"> — ' + extra + '</span>';
  }
  titleText.innerHTML = '<span class="window-title-icon">' + app.icon + '</span> ' + titleStr;

  // Controls
  const controls = document.createElement("div");
  controls.className = "window-controls";

  const closeBtn = document.createElement("button");
  closeBtn.className = "window-close-btn";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeWindow(windowId);
  });

  controls.appendChild(closeBtn);
  titleBar.appendChild(titleText);
  titleBar.appendChild(controls);

  // Window content (placeholder)
  const content = document.createElement("div");
  content.className = "window-content";
  content.innerHTML = '<div class="placeholder-content"><div class="placeholder-icon">' + app.icon + '</div><div class="placeholder-text">' + app.name + ' — content loads here</div></div>';

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "window-resize-handle";

  el.appendChild(titleBar);
  el.appendChild(content);
  el.appendChild(resizeHandle);

  // Focus on click
  el.addEventListener("mousedown", (e) => {
    // Don't handle if clicking close button
    if (e.target.closest(".window-close-btn")) return;
    focusWindow(windowId);
  });

  return el;
}

/**
 * Focus (raise) a window to the top of the z-order.
 */
function focusWindow(windowId) {
  // Remove focused class from all windows
  document.querySelectorAll(".window.focused").forEach(w => w.classList.remove("focused"));

  const windowEl = document.getElementById(windowId);
  if (!windowEl) return;

  // Raise z-index
  currentZIndex++;
  windowEl.style.zIndex = currentZIndex;

  // Add focused class
  windowEl.classList.add("focused");
  focusedWindowId = windowId;

  // Update taskbar
  updateTaskbar();
}

/**
 * Close a window by its ID.
 */
function closeWindow(windowId) {
  const windowEl = document.getElementById(windowId);
  if (!windowEl) return;

  const appId = windowEl.dataset.app;

  // Remove from DOM
  windowEl.remove();

  // Remove from maps
  if (appId && windowMap[appId] === windowId) {
    delete windowMap[appId];
  }
  delete appIdMap[windowId];

  // If the closed window was focused, focus the next one
  if (focusedWindowId === windowId) {
    focusedWindowId = null;
    const remaining = document.querySelectorAll(".window");
    if (remaining.length > 0) {
      focusWindow(remaining[remaining.length - 1].id);
    }
  }

  updateTaskbar();
}

// ============================================================
// SECTION 4: Window Dragging
// ============================================================

let dragState = null;

/**
 * Initialize dragging for a window's title bar.
 */
function initWindowDrag(windowElement, titleBar) {
  titleBar.addEventListener("mousedown", (e) => {
    if (e.target.closest(".window-controls") || e.button !== 0) return;

    const windowId = windowElement.id;
    const rect = windowElement.getBoundingClientRect();

    dragState = {
      windowId: windowId,
      startX: e.clientX,
      startY: e.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };

    windowElement.classList.add("dragging");
    titleBar.classList.add("dragging");

    // Focus the window being dragged
    focusWindow(windowId);

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragState) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    handleWindowDragMove(dx, dy);
  });

  document.addEventListener("mouseup", () => {
    if (!dragState) return;

    handleWindowDragEnd();

    const windowEl = document.getElementById(dragState.windowId);
    if (windowEl) windowEl.classList.remove("dragging");
    const titleBarEl = windowEl.querySelector(".window-titlebar");
    if (titleBarEl) titleBarEl.classList.remove("dragging");

    dragState = null;
  });
}

/**
 * Handle mouse move during window drag.
 */
function handleWindowDragMove(dx, dy) {
  if (!dragState) return;

  const windowElement = document.getElementById(dragState.windowId);
  if (!windowElement) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight - 48; // subtract taskbar height
  const winW = windowElement.offsetWidth;
  const winH = windowElement.offsetHeight;

  let left = dragState.startLeft + dx;
  let top = dragState.startTop + dy;

  // Constrain to viewport
  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + winW > viewportWidth) left = viewportWidth - winW;
  if (top + winH > viewportHeight) top = viewportHeight - winH;

  windowElement.style.left = left + "px";
  windowElement.style.top = top + "px";
}

/**
 * Handle mouse up after window drag — constrain to viewport.
 */
function handleWindowDragEnd() {
  if (!dragState) return;

  const windowElement = document.getElementById(dragState.windowId);
  if (!windowElement) return;

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight - 48;
  const winW = windowElement.offsetWidth;
  const winH = windowElement.offsetHeight;

  let left = parseInt(windowElement.style.left) || 0;
  let top = parseInt(windowElement.style.top) || 0;

  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + winW > viewportWidth) left = viewportWidth - winW;
  if (top + winH > viewportHeight) top = viewportHeight - winH;

  windowElement.style.left = left + "px";
  windowElement.style.top = top + "px";
}

// ============================================================
// SECTION 5: Window Resizing
// ============================================================

let resizeState = null;

/**
 * Initialize resizing for a window.
 */
function initWindowResize(windowElement) {
  const resizeHandle = windowElement.querySelector(".window-resize-handle");
  if (!resizeHandle) return;

  resizeHandle.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;

    resizeState = {
      windowId: windowElement.id,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: windowElement.offsetWidth,
      startHeight: windowElement.offsetHeight,
    };

    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizeState) return;

    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;

    handleWindowResizeMove(dx, dy);
  });

  document.addEventListener("mouseup", () => {
    handleWindowResizeEnd();
    resizeState = null;
  });
}

/**
 * Handle mouse move during window resize.
 */
function handleWindowResizeMove(dx, dy) {
  if (!resizeState) return;

  const windowElement = document.getElementById(resizeState.windowId);
  if (!windowElement) return;

  const newWidth = Math.max(320, resizeState.startWidth + dx);
  const newHeight = Math.max(200, resizeState.startHeight + dy);

  windowElement.style.width = newWidth + "px";
  windowElement.style.height = newHeight + "px";
}

/**
 * Handle mouse up after window resize.
 */
function handleWindowResizeEnd() {
  // No additional action needed — constraints applied during resize
}

// ============================================================
// SECTION 6: Taskbar
// ============================================================

/**
 * Update the taskbar to reflect current open windows.
 */
function updateTaskbar() {
  const appsContainer = document.getElementById("taskbar-apps");
  appsContainer.innerHTML = "";

  for (const [appId, windowId] of Object.entries(windowMap)) {
    const app = APPS[appId];
    const btn = document.createElement("button");
    btn.className = "taskbar-btn";
    btn.dataset.app = appId;
    if (windowId === focusedWindowId) {
      btn.classList.add("active");
    }

    const icon = document.createElement("span");
    icon.className = "taskbar-btn-icon";
    icon.textContent = app.icon;

    const label = document.createElement("span");
    label.textContent = app.name;

    btn.appendChild(icon);
    btn.appendChild(label);

    btn.addEventListener("click", () => handleTaskbarButtonClick(windowId));
    appsContainer.appendChild(btn);
  }
}

/**
 * Handle a taskbar button click — focus the corresponding window.
 */
function handleTaskbarButtonClick(windowId) {
  const windowEl = document.getElementById(windowId);
  if (!windowEl) return;

  // If this window is already focused, minimize it (remove focus)
  if (windowId === focusedWindowId) {
    windowEl.classList.remove("focused");
    focusedWindowId = null;
    // Try to focus another window
    const remaining = document.querySelectorAll(".window");
    if (remaining.length > 0) {
      focusWindow(remaining[remaining.length - 1].id);
    }
    updateTaskbar();
    return;
  }

  focusWindow(windowId);
}

/**
 * Update the clock display.
 */
function updateClock() {
  const clockEl = document.getElementById("taskbar-clock");
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  clockEl.textContent = hours + ":" + minutes;
}

// ============================================================
// SECTION 7: Context Menu (Right-click on desktop)
// ============================================================

/**
 * Show the wallpaper context menu.
 */
function showContextMenu(x, y) {
  let menu = document.getElementById("context-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.id = "context-menu";
    menu.className = "context-menu";

    // Wallpaper option
    const wallpaperItem = document.createElement("div");
    wallpaperItem.className = "context-menu-item";
    wallpaperItem.textContent = "Change wallpaper…";
    wallpaperItem.addEventListener("click", (e) => {
      e.stopPropagation();
      showWallpaperPicker();
    });

    menu.appendChild(wallpaperItem);
    document.body.appendChild(menu);
  }

  // Position menu
  const menuWidth = 200;
  const menuHeight = 40;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth - 4);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight - 4);

  menu.style.left = adjustedX + "px";
  menu.style.top = adjustedY + "px";
  menu.classList.add("visible");
}

/**
 * Hide the context menu.
 */
function hideContextMenu() {
  const menu = document.getElementById("context-menu");
  if (menu) menu.classList.remove("visible");
}

// ============================================================
// SECTION 8: Wallpaper
// ============================================================

/**
 * Set the desktop wallpaper by preset index.
 */
function setWallpaper(presetIndex) {
  const desktop = document.getElementById("desktop");
  // Remove all wallpaper classes
  for (let i = 0; i < 8; i++) {
    desktop.classList.remove("wallpaper-" + i);
  }
  desktop.classList.add("wallpaper-" + presetIndex);

  // Persist to localStorage
  localStorage.setItem("browser-os-wallpaper", String(presetIndex));

  hideWallpaperPicker();
  hideContextMenu();
}

/**
 * Show the wallpaper picker.
 */
function showWallpaperPicker() {
  let picker = document.getElementById("wallpaper-picker");
  if (!picker) {
    picker = document.createElement("div");
    picker.id = "wallpaper-picker";
    picker.className = "wallpaper-picker";

    const title = document.createElement("div");
    title.className = "wallpaper-picker-title";
    title.textContent = "Choose wallpaper";

    const grid = document.createElement("div");
    grid.className = "wallpaper-picker-grid";

    for (let i = 0; i < 8; i++) {
      const option = document.createElement("div");
      option.className = "wallpaper-option";
      option.dataset.index = i;
      option.style.border = "1px solid #ddd";
      // Apply the wallpaper class as background
      const desktop = document.getElementById("desktop");
      // Clone the wallpaper style for the thumbnail
      const thumbStyle = option.style;
      if (i === 0) {
        thumbStyle.background = "linear-gradient(135deg, #1a5276, #3a6b8c, #1a5276)";
      } else if (i === 1) {
        thumbStyle.background = "linear-gradient(135deg, #4a148c, #7b1fa2, #4a148c)";
      } else if (i === 2) {
        thumbStyle.background = "linear-gradient(135deg, #bf360c, #e65100, #ff6e40)";
      } else if (i === 3) {
        thumbStyle.background = "linear-gradient(135deg, #1b5e20, #388e3c, #1b5e20)";
      } else if (i === 4) {
        thumbStyle.background = "linear-gradient(135deg, #0d1b2a, #1b263b, #0d1b2a)";
      } else if (i === 5) {
        thumbStyle.background = "linear-gradient(135deg, #880e4f, #c2185b, #880e4f)";
      } else if (i === 6) {
        thumbStyle.background = "#e8e8e8";
      } else if (i === 7) {
        thumbStyle.background = "#263238";
        thumbStyle.backgroundImage = "radial-gradient(circle, #37474f 1px, transparent 1px)";
        thumbStyle.backgroundSize = "8px 8px";
      }

      // Current selection indicator
      const currentPreset = parseInt(localStorage.getItem("browser-os-wallpaper") || "0");
      if (i === currentPreset) {
        option.classList.add("selected");
      }

      option.addEventListener("click", (e) => {
        e.stopPropagation();
        // Update selection
        document.querySelectorAll(".wallpaper-option").forEach(o => o.classList.remove("selected"));
        option.classList.add("selected");
        setWallpaper(i);
      });

      grid.appendChild(option);
    }

    picker.appendChild(title);
    picker.appendChild(grid);
    document.body.appendChild(picker);
  }

  // Position the picker above the taskbar on the right
  picker.style.right = "8px";
  picker.style.bottom = "56px";
  picker.classList.add("visible");
}

/**
 * Hide the wallpaper picker.
 */
function hideWallpaperPicker() {
  const picker = document.getElementById("wallpaper-picker");
  if (picker) picker.classList.remove("visible");
}

// ============================================================
// SECTION 9: Initialization
// ============================================================

/**
 * Initialize the entire desktop shell.
 */
function init() {
  createDesktopIcons();
  updateClock();
  setInterval(updateClock, 1000);
  restoreWallpaper();
}

/**
 * Restore wallpaper from localStorage.
 */
function restoreWallpaper() {
  const preset = parseInt(localStorage.getItem("browser-os-wallpaper") || "0");
  setWallpaper(preset);
}

// ============================================================
// SECTION 10: Calculator
// ============================================================

/**
 * Calculator state.
 */
const calc = {
  currentDisplay: "0",     // Current display value
  expression: "",          // Current expression string
  operator: null,          // Pending operator (+, -, ×, ÷, %)
  previousValue: null,     // Previous numeric value
  waitingForOperand: false,// Whether the next digit starts a new number
  justEvaluated: false,    // Whether the last action was '='
  error: false,            // Whether we're in an error state
  activeOperator: null,    // Currently highlighted operator button
};

/**
 * Build the calculator UI inside the given container.
 */
function initCalculator(container, windowId) {
  // Clear any placeholder
  container.innerHTML = "";

  // Set window ID for keyboard handling
  if (windowId) {
    container.closest(".window").id = windowId;
  }

  // Display area
  const display = document.createElement("div");
  display.className = "calculator-display";
  display.id = "calc-display";

  const expression = document.createElement("div");
  expression.className = "calc-expression";
  expression.id = "calc-expression";

  const current = document.createElement("div");
  current.className = "calc-current";
  current.id = "calc-current";

  display.appendChild(expression);
  display.appendChild(current);
  container.appendChild(display);

  // Button grid
  const buttons = document.createElement("div");
  buttons.className = "calculator-buttons";

  const buttonRows = [
    ["C", "±", "%", "÷"],
    ["7", "8", "9", "×"],
    ["4", "5", "6", "−"],
    ["1", "2", "3", "+"],
    ["0", ".", "="],
  ];

  for (const row of buttonRows) {
    for (const label of row) {
      const btn = document.createElement("button");
      btn.className = "calc-btn";
      btn.textContent = label;
      btn.dataset.value = label;

      // Assign button class based on type
      if (label === "C") {
        btn.classList.add("clear");
      } else if (label === "±" || label === "%") {
        btn.classList.add("function-btn");
      } else if ("÷×−+".includes(label)) {
        btn.classList.add("operator");
      } else if (label === "=") {
        btn.classList.add("equals");
      } else if (label === "0") {
        btn.classList.add("zero");
      }

      btn.addEventListener("click", () => handleCalcButton(label));
      buttons.appendChild(btn);
    }
  }

  container.appendChild(buttons);

  // Keyboard support
  document.addEventListener("keydown", handleCalcKeydown);

  // Initialize the display
  updateCalcDisplay();
}

/**
 * Handle a calculator button press.
 */
function handleCalcButton(label) {
  if (label === "C") {
    clearCalc();
    return;
  }

  if (label === "±") {
    toggleSign();
    return;
  }

  if (label === "%") {
    handlePercent();
    return;
  }

  if ("÷×−+".includes(label)) {
    handleOperator(label);
    return;
  }

  if (label === "=") {
    handleEquals();
    return;
  }

  // Digits and decimal point
  if ("0123456789.".includes(label)) {
    handleDigit(label);
  }
}

/**
 * Handle a digit or decimal point key.
 */
function handleDigit(digit) {
  if (calc.error) {
    calc.error = false;
  }

  if (calc.waitingForOperand || calc.justEvaluated) {
    // Start a new operand
    calc.currentDisplay = digit;
    if (digit !== "0" || !calc.waitingForOperand) {
      calc.expression = calc.previousValue !== null ? formatDisplay(calc.previousValue) : digit;
    } else {
      calc.expression = digit;
    }
    calc.waitingForOperand = false;
    calc.justEvaluated = false;
  } else {
    // Append to current display
    if (digit === "." && calc.currentDisplay.includes(".")) {
      return; // No double decimals
    }
    if (digit === "0" && calc.currentDisplay === "0") {
      return; // No leading zeros
    }
    // Limit display length
    if (calc.currentDisplay.replace(".", "").length >= 15) {
      return;
    }
    calc.currentDisplay += digit;
    calc.expression = calc.currentDisplay;
  }

  updateCalcDisplay();
}

/**
 * Handle an operator key (+, -, ×, ÷).
 */
function handleOperator(op) {
  calc.justEvaluated = false;

  if (calc.error) {
    clearCalc();
    return;
  }

  if (calc.previousValue !== null && !calc.waitingForOperand) {
    // Already have an operator pending, evaluate first
    const result = calculate(calc.previousValue, parseFloat(calc.currentDisplay), calc.operator);
    if (result === null) {
      calc.error = true;
      calc.currentDisplay = "Error";
      calc.expression = "Error";
      calc.previousValue = null;
      calc.operator = null;
      updateCalcDisplay();
      return;
    }
    calc.currentDisplay = formatDisplay(result);
    calc.previousValue = result;
    calc.expression = calc.currentDisplay + " " + op;
  } else {
    calc.previousValue = parseFloat(calc.currentDisplay);
    calc.expression = calc.previousValue + " " + op;
  }

  calc.operator = op;
  calc.waitingForOperand = true;

  // Highlight the active operator
  highlightActiveOperator(op);
  updateCalcDisplay();
}

/**
 * Handle the equals key.
 */
function handleEquals() {
  if (calc.error) {
    clearCalc();
    return;
  }

  if (calc.previousValue === null || calc.operator === null) {
    return; // Nothing to evaluate
  }

  const currentValue = parseFloat(calc.currentDisplay);
  const result = calculate(calc.previousValue, currentValue, calc.operator);

  if (result === null) {
    calc.error = true;
    calc.currentDisplay = "Error";
    calc.expression = calc.previousValue + " " + calc.operator + " " + currentValue;
    calc.previousValue = null;
    calc.operator = null;
    calc.justEvaluated = true;
    highlightActiveOperator(null);
    updateCalcDisplay();
    return;
  }

  calc.expression = formatDisplay(calc.previousValue) + " " + calc.operator + " " + formatDisplay(currentValue) + " = ";
  calc.currentDisplay = formatDisplay(result);
  calc.previousValue = result;
  calc.operator = null;
  calc.waitingForOperand = true;
  calc.justEvaluated = true;
  highlightActiveOperator(null);
  updateCalcDisplay();
}

/**
 * Clear the calculator.
 */
function clearCalc() {
  calc.currentDisplay = "0";
  calc.expression = "";
  calc.operator = null;
  calc.previousValue = null;
  calc.waitingForOperand = false;
  calc.justEvaluated = false;
  calc.error = false;
  highlightActiveOperator(null);
  updateCalcDisplay();
}

/**
 * Toggle the sign of the current display value.
 */
function toggleSign() {
  if (calc.error) return;
  if (calc.currentDisplay === "0") return;
  if (calc.currentDisplay.startsWith("-")) {
    calc.currentDisplay = calc.currentDisplay.substring(1);
  } else {
    calc.currentDisplay = "-" + calc.currentDisplay;
  }
  if (!calc.waitingForOperand) {
    calc.expression = calc.currentDisplay;
  }
  updateCalcDisplay();
}

/**
 * Handle the percent key: divide current value by 100.
 */
function handlePercent() {
  if (calc.error) return;
  if (calc.currentDisplay === "0") return;
  const value = parseFloat(calc.currentDisplay);
  calc.currentDisplay = formatDisplay(value / 100);
  if (!calc.waitingForOperand) {
    calc.expression = calc.currentDisplay;
  }
  updateCalcDisplay();
}

/**
 * Perform a calculation: first operator second.
 */
function calculate(first, second, operator) {
  switch (operator) {
    case "+":
      return first + second;
    case "−":
      return first - second;
    case "×":
      return first * second;
    case "÷":
      if (second === 0) return null; // Error: divide by zero
      return first / second;
    default:
      return second;
  }
}

/**
 * Format a number for display. Truncate to 15 significant digits.
 */
function formatDisplay(value) {
  if (!isFinite(value)) {
    return "Error";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  // Format with up to 12 decimal places, removing trailing zeros
  const str = value.toFixed(12);
  return parseFloat(str).toString();
}

/**
 * Highlight the currently active operator button.
 */
function highlightActiveOperator(op) {
  calc.activeOperator = op;
  document.querySelectorAll(".calc-btn.operator").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.value === op);
  });
}

/**
 * Update the calculator display elements.
 */
function updateCalcDisplay() {
  const exprEl = document.getElementById("calc-expression");
  const currentEl = document.getElementById("calc-current");
  if (!exprEl || !currentEl) return;

  exprEl.textContent = calc.expression;

  // Adjust font size for long numbers
  if (calc.currentDisplay.length > 12) {
    currentEl.classList.add("small");
  } else {
    currentEl.classList.remove("small");
  }

  // Error styling
  if (calc.error) {
    currentEl.classList.add("error");
  } else {
    currentEl.classList.remove("error");
  }

  currentEl.textContent = calc.currentDisplay;
}

/**
 * Handle keyboard input for the calculator.
 */
function handleCalcKeydown(e) {
  // Only respond if the calculator window is focused
  const calcWindowId = windowMap["calculator"];
  if (!calcWindowId) return;
  const calcWindow = document.getElementById(calcWindowId);
  if (!calcWindow || !calcWindow.classList.contains("focused")) return;

  const key = e.key;

  if ("0123456789".includes(key)) {
    e.preventDefault();
    handleCalcButton(key);
  } else if (key === "." || key === ",") {
    e.preventDefault();
    handleCalcButton(".");
  } else if (key === "+") {
    e.preventDefault();
    handleCalcButton("+");
  } else if (key === "-") {
    e.preventDefault();
    handleCalcButton("−");
  } else if (key === "*" || key === "x" || key === "X") {
    e.preventDefault();
    handleCalcButton("×");
  } else if (key === "/") {
    e.preventDefault();
    handleCalcButton("÷");
  } else if (key === "%") {
    e.preventDefault();
    handleCalcButton("%");
  } else if (key === "Enter" || key === "=") {
    e.preventDefault();
    handleCalcButton("=");
  } else if (key === "Escape" || key === "Delete") {
    e.preventDefault();
    handleCalcButton("C");
  } else if (key === "Backspace") {
    e.preventDefault();
    handleBackspace();
  }
}

/**
 * Handle backspace: remove last digit from current display.
 */
function handleBackspace() {
  if (calc.error) {
    clearCalc();
    return;
  }
  if (calc.waitingForOperand || calc.justEvaluated) {
    return;
  }
  if (calc.currentDisplay.length <= 1 || (calc.currentDisplay.length === 2 && calc.currentDisplay.startsWith("-"))) {
    calc.currentDisplay = "0";
  } else {
    calc.currentDisplay = calc.currentDisplay.slice(0, -1);
  }
  calc.expression = calc.currentDisplay;
  updateCalcDisplay();
}

// ============================================================
// SECTION 11: Notepad
// ============================================================

/**
 * localStorage key for notepad documents.
 */
const NOTEPAD_DOCS_KEY = "browser-os-notepad-docs";

/**
 * Generate the next "Untitled N" name.
 */
function getUntitledName() {
  const docs = getNotepadDocs();
  let n = 1;
  while (docs["Untitled " + n]) {
    n++;
  }
  return "Untitled " + n;
}

/**
 * Load documents from localStorage.
 */
function getNotepadDocs() {
  const raw = localStorage.getItem(NOTEPAD_DOCS_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save documents to localStorage.
 */
function saveNotepadDocs(docs) {
  localStorage.setItem(NOTEPAD_DOCS_KEY, JSON.stringify(docs));
}

/**
 * Notepad state for the current window.
 */
const notepadState = {
  docListEl: null,  // DOM element for the document list
};

/**
 * Initialize the Notepad application.
 */
function initNotepad(container, windowId) {
  // Clear any placeholder
  container.innerHTML = "";

  // Set window ID for keyboard handling
  if (windowId) {
    container.closest(".window").id = windowId;
  }

  // Main container
  const main = document.createElement("div");
  main.id = "notepad-content";

  // Sidebar
  const sidebar = document.createElement("div");
  sidebar.className = "notepad-sidebar";

  // Sidebar header with title and new doc button
  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "notepad-sidebar-header";

  const sidebarTitle = document.createElement("div");
  sidebarTitle.className = "notepad-sidebar-title";
  sidebarTitle.textContent = "Documents";

  const newDocBtn = document.createElement("button");
  newDocBtn.className = "notepad-sidebar-btn";
  newDocBtn.textContent = "+";
  newDocBtn.title = "New document";
  newDocBtn.addEventListener("click", () => notepadNewDoc());

  sidebarHeader.appendChild(sidebarTitle);
  sidebarHeader.appendChild(newDocBtn);

  // Document list
  const docList = document.createElement("div");
  docList.className = "notepad-doc-list";
  docList.id = "notepad-doc-list";

  sidebar.appendChild(sidebarHeader);
  sidebar.appendChild(docList);

  // Actions bar
  const actionsBar = document.createElement("div");
  actionsBar.className = "notepad-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "notepad-action-btn";
  saveBtn.textContent = "💾 Save";
  saveBtn.addEventListener("click", () => notepadSaveDoc());

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "notepad-action-btn danger";
  deleteBtn.textContent = "🗑 Delete";
  deleteBtn.addEventListener("click", () => notepadDeleteDoc());

  actionsBar.appendChild(saveBtn);
  actionsBar.appendChild(deleteBtn);

  sidebar.appendChild(actionsBar);
  main.appendChild(sidebar);

  // Editor area
  const editorArea = document.createElement("div");
  editorArea.className = "notepad-editor-area";

  // Editor header (shows current doc name and status)
  const editorHeader = document.createElement("div");
  editorHeader.className = "notepad-editor-header";

  const docNameLabel = document.createElement("span");
  docNameLabel.id = "notepad-doc-name";
  docNameLabel.textContent = "No document opened";

  const docStatus = document.createElement("span");
  docStatus.id = "notepad-doc-status";
  docStatus.className = "notepad-doc-status";

  editorHeader.appendChild(docNameLabel);
  editorHeader.appendChild(docStatus);

  // Textarea
  const textarea = document.createElement("textarea");
  textarea.id = "notepad-textarea";
  textarea.className = "notepad-textarea";
  textarea.placeholder = "Start typing...";
  textarea.addEventListener("input", () => {
    notepadMarkModified();
  });
  textarea.addEventListener("keydown", handleNotepadKeydown);

  editorArea.appendChild(editorHeader);
  editorArea.appendChild(textarea);

  // Empty state (shown when no doc is open)
  const emptyState = document.createElement("div");
  emptyState.className = "notepad-empty";
  emptyState.id = "notepad-empty-state";
  emptyState.innerHTML = "<div class=\"empty-icon\">📝</div><div class=\"empty-text\">Select or create a document</div>";
  emptyState.style.display = "none";

  editorArea.appendChild(emptyState);
  main.appendChild(editorArea);
  container.appendChild(main);

  // Store reference to the doc list element
  notepadState.docListEl = docList;

  // Render the document list
  notepadRenderDocList();

  // If there are no documents, show empty state
  const docs = getNotepadDocs();
  if (Object.keys(docs).length === 0) {
    notepadShowEmptyState(true);
  }
}

/**
 * Render the document list in the sidebar.
 */
function notepadRenderDocList() {
  const docs = getNotepadDocs();
  const docListEl = notepadState.docListEl;
  if (!docListEl) return;

  docListEl.innerHTML = "";

  const sortedNames = Object.keys(docs).sort();

  for (const name of sortedNames) {
    const item = document.createElement("div");
    item.className = "notepad-doc-item";
    item.dataset.name = name;

    const nameSpan = document.createElement("span");
    nameSpan.className = "notepad-doc-name";
    nameSpan.textContent = name;

    item.appendChild(nameSpan);
    item.addEventListener("click", () => notepadOpenDoc(name));

    docListEl.appendChild(item);
  }

  // Highlight the currently open document
  const currentDoc = window.notepadCurrentDoc;
  if (currentDoc) {
    const activeItem = docListEl.querySelector('.notepad-doc-item[data-name="' + currentDoc + '"]');
    if (activeItem) {
      activeItem.classList.add("active");
    }
  }
}

/**
 * Open a document by name.
 */
function notepadOpenDoc(name) {
  const docs = getNotepadDocs();
  const content = docs[name];
  if (content === undefined) return;

  // If there was a previous document, mark it as saved
  window.notepadCurrentDoc = name;
  window.notepadModified = false;

  const textarea = document.getElementById("notepad-textarea");
  textarea.value = content;

  // Show editor, hide empty state
  notepadShowEmptyState(false);

  // Update header
  document.getElementById("notepad-doc-name").textContent = name;
  document.getElementById("notepad-doc-status").textContent = "";
  document.getElementById("notepad-doc-status").classList.remove("modified");

  // Update window title bar to show current document name
  updateNotepadWindowTitle(name);

  // Highlight in doc list
  notepadRenderDocList();
}

/**
 * Create a new document.
 */
function notepadNewDoc() {
  const name = getUntitledName();
  const docs = getNotepadDocs();
  docs[name] = "";
  saveNotepadDocs(docs);

  // Open the new document
  notepadOpenDoc(name);

  // Focus the textarea
  const textarea = document.getElementById("notepad-textarea");
  textarea.focus();
}

/**
 * Save the current document.
 */
function notepadSaveDoc() {
  const name = window.notepadCurrentDoc;
  if (!name) return;

  const textarea = document.getElementById("notepad-textarea");
  const content = textarea.value;

  const docs = getNotepadDocs();
  docs[name] = content;
  saveNotepadDocs(docs);

  window.notepadModified = false;

  // Update status
  const docStatus = document.getElementById("notepad-doc-status");
  docStatus.textContent = "";
  docStatus.classList.remove("modified");
}

/**
 * Delete the current document with confirmation.
 */
function notepadDeleteDoc() {
  const name = window.notepadCurrentDoc;
  if (!name) return;

  const confirmed = confirm("Delete \"" + name + "\"? This action cannot be undone.");
  if (!confirmed) return;

  const docs = getNotepadDocs();
  delete docs[name];
  saveNotepadDocs(docs);

  // Clear the editor
  window.notepadCurrentDoc = null;
  window.notepadModified = false;

  const textarea = document.getElementById("notepad-textarea");
  textarea.value = "";

  // Update header
  document.getElementById("notepad-doc-name").textContent = "No document opened";
  document.getElementById("notepad-doc-status").textContent = "";

  // Update window title bar
  updateNotepadWindowTitle("");

  // Show empty state
  notepadShowEmptyState(true);

  // Re-render the doc list
  notepadRenderDocList();
}

/**
 * Mark the current document as modified (unsaved).
 */
function notepadMarkModified() {
  if (!window.notepadCurrentDoc) return;
  window.notepadModified = true;

  const docStatus = document.getElementById("notepad-doc-status");
  docStatus.textContent = "(unsaved changes)";
  docStatus.classList.add("modified");
}

/**
 * Show or hide the empty state in the editor area.
 */
function notepadShowEmptyState(show) {
  const textarea = document.getElementById("notepad-textarea");
  const emptyState = document.getElementById("notepad-empty-state");
  if (show) {
    textarea.style.display = "none";
    emptyState.style.display = "flex";
  } else {
    textarea.style.display = "";
    emptyState.style.display = "none";
  }
}

/**
 * Update the Notepad window title bar to show current document name.
 */
function updateNotepadWindowTitle(docName) {
  const windowId = windowMap["notepad"];
  if (!windowId) return;

  const windowEl = document.getElementById(windowId);
  if (!windowEl) return;

  const titleText = windowEl.querySelector(".window-title-text");
  if (!titleText) return;

  const app = APPS.notepad;
  let titleStr = "Notepad";
  if (docName) {
    titleStr += " — " + docName;
  }

  titleText.innerHTML = '<span class="window-title-icon">' + app.icon + '</span> ' + titleStr;
}

/**
 * Handle keyboard shortcuts in the Notepad.
 */
function handleNotepadKeydown(e) {
  // Only respond if the notepad window is focused
  const notepadWindowId = windowMap["notepad"];
  if (!notepadWindowId) return;
  const notepadWindow = document.getElementById(notepadWindowId);
  if (!notepadWindow || !notepadWindow.classList.contains("focused")) return;

  const key = e.key;

  // Ctrl/Cmd + S: Save
  if ((e.ctrlKey || e.metaKey) && key.toLowerCase() === "s") {
    e.preventDefault();
    notepadSaveDoc();
  }

  // Tab: insert spaces
  if (key === "Tab") {
    e.preventDefault();
    const textarea = e.target;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    textarea.value = value.substring(0, start) + "    " + value.substring(end);
    textarea.selectionStart = textarea.selectionEnd = start + 4;
    notepadMarkModified();
  }
}

// ============================================================
// SECTION 12: Minesweeper
// ============================================================

/**
 * Difficulty definitions.
 */
const MINESWEEPER_DIFFICULTIES = {
  beginner: { cols: 9, rows: 9, mines: 10 },
  intermediate: { cols: 16, rows: 16, mines: 40 },
  expert: { cols: 30, rows: 16, mines: 99 },
};

/**
 * Minesweeper state for the current window.
 */
const minesweeperState = {
  currentDifficulty: "beginner",
  board: null,        // 2D array of cell states
  gameOver: false,
  firstClick: true,
  started: false,
  timerInterval: null,
  timeElapsed: 0,
  minesPlaced: false,
  revealedCount: 0,
};

// Expose Minesweeper state to window for testing
window.Minesweeper = minesweeperState;
window.MinesweeperDifficulty = MINESWEEPER_DIFFICULTIES;

/**
 * Self-test: verify core Minesweeper functionality.
 */
function runMinesweeperSelfTest() {
  const results = [];

  try {
    // Test 1: Verify state exists on window
    if (window.Minesweeper !== undefined) {
      results.push("PASS - Minesweeper state exposed on window");
    } else {
      results.push("FAIL - Minesweeper state not on window");
    }

    // Test 2: Verify difficulty configs
    if (MinesweeperDifficulty.beginner && MinesweeperDifficulty.intermediate && MinesweeperDifficulty.expert) {
      results.push("PASS - All three difficulty levels defined");
    } else {
      results.push("FAIL - Missing difficulty levels");
    }

    // Test 3: Verify beginner settings
    if (MinesweeperDifficulty.beginner.rows === 9 && MinesweeperDifficulty.beginner.cols === 9 && MinesweeperDifficulty.beginner.mines === 10) {
      results.push("PASS - Beginner: 9x9 with 10 mines");
    } else {
      results.push("FAIL - Beginner settings incorrect");
    }

    // Test 4: Verify intermediate settings
    if (MinesweeperDifficulty.intermediate.rows === 16 && MinesweeperDifficulty.intermediate.cols === 16 && MinesweeperDifficulty.intermediate.mines === 40) {
      results.push("PASS - Intermediate: 16x16 with 40 mines");
    } else {
      results.push("FAIL - Intermediate settings incorrect");
    }

    // Test 5: Verify expert settings
    if (MinesweeperDifficulty.expert.rows === 16 && MinesweeperDifficulty.expert.cols === 30 && MinesweeperDifficulty.expert.mines === 99) {
      results.push("PASS - Expert: 30x16 with 99 mines");
    } else {
      results.push("FAIL - Expert settings incorrect");
    }

    // Restart game to ensure fresh state for remaining tests
    restartGame();

    // Test 6: Verify firstClick is true after restart
    if (Minesweeper.firstClick === true) {
      results.push("PASS - First click protection active after restart");
    } else {
      results.push("FAIL - First click not in initial state");
    }

    // Test 7: Verify board is initialized after restart
    if (Minesweeper.board !== null) {
      results.push("PASS - Board initialized after restart");
    } else {
      results.push("FAIL - Board not initialized after restart");
    }

    // Test 8: Verify game over is false after restart
    if (Minesweeper.gameOver === false) {
      results.push("PASS - Game not over after restart");
    } else {
      results.push("FAIL - Game already over after restart");
    }

    // Test 9: Verify timer is null after restart
    if (Minesweeper.timerInterval === null) {
      results.push("PASS - Timer not started after restart");
    } else {
      results.push("FAIL - Timer already running after restart");
    }

    // Test 10: Verify timer is 0 after restart
    if (Minesweeper.timeElapsed === 0) {
      results.push("PASS - Timer starts at 0 after restart");
    } else {
      results.push("FAIL - Timer not at 0 after restart");
    }

    // Test 11: Verify flood fill works by creating a board and testing
    const testBoard = createBoard(5, 5);
    testBoard[2][2].isMine = true; // Place mine in center
    testBoard[1][2].neighborCount = 1;
    testBoard[2][1].neighborCount = 1;
    testBoard[2][3].neighborCount = 1;
    testBoard[3][2].neighborCount = 1;
    // Set neighbors to empty
    testBoard[0][0].neighborCount = 0;
    testBoard[0][1].neighborCount = 0;
    testBoard[1][0].neighborCount = 0;

    let revealedBefore = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (testBoard[r][c].revealed) revealedBefore++;
      }
    }

    floodReveal(testBoard, 5, 5, 0, 0);

    let revealedAfter = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (testBoard[r][c].revealed) revealedAfter++;
      }
    }

    if (revealedAfter > revealedBefore) {
      results.push("PASS - Flood fill reveals cells recursively");
    } else {
      results.push("FAIL - Flood fill not working");
    }

    // Test 16: Verify first-click mine placement avoids clicked cell
    const board1 = createBoard(5, 5);
    placeMines(board1, 5, 5, 3, 0, 0); // Click at (0,0)
    let minesNearFirstClick = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = 0 + dr;
        const nc = 0 + dc;
        if (nr >= 0 && nr < 5 && nc >= 0 && nc < 5 && board1[nr][nc].isMine) {
          minesNearFirstClick++;
        }
      }
    }
    if (minesNearFirstClick === 0) {
      results.push("PASS - First click safe zone (no mines around clicked cell)");
    } else {
      results.push("FAIL - Mine placed in first-click safe zone");
    }

    // Test 17: Verify mine placement places correct number of mines
    const board2 = createBoard(5, 5);
    placeMines(board2, 5, 5, 5, 2, 2); // Click at center, 5 mines
    let mineCount = 0;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        if (board2[r][c].isMine) mineCount++;
      }
    }
    if (mineCount === 5) {
      results.push("PASS - Mine placement places correct number of mines (5)");
    } else {
      results.push("FAIL - Mine placement: " + mineCount + " mines placed (expected 5)");
    }

    // Test 18: Verify neighbor count calculation
    const board3 = createBoard(3, 3);
    // Place mines at (0,0) and (2,2) so edge cells have 2 neighbors
    board3[0][0].isMine = true;
    board3[2][2].isMine = true;
    // Recalculate neighbors for all cells
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (!board3[r][c].isMine) {
          board3[r][c].neighborCount = countNeighbors(board3, 3, 3, r, c);
        }
      }
    }
    // (1,0) is adjacent to (0,0) only → 1 neighbor
    // (0,1) is adjacent to (0,0) only → 1 neighbor
    // (1,2) is adjacent to (2,2) only → 1 neighbor
    // (2,1) is adjacent to (2,2) only → 1 neighbor
    // (1,1) is adjacent to both (0,0) and (2,2) → 2 neighbors
    if (board3[1][0].neighborCount === 1 && board3[1][1].neighborCount === 2) {
      results.push("PASS - Neighbor count calculation correct");
    } else {
      results.push("FAIL - Neighbor count: (1,0)=" + board3[1][0].neighborCount + ", (1,1)=" + board3[1][1].neighborCount);
    }

    // Test 19: Verify UI elements exist when Minesweeper is open
    const mineCounterEl = document.getElementById("minesweeper-mine-counter");
    if (mineCounterEl) {
      results.push("PASS - Mine counter element found");
    } else {
      results.push("SKIP - Mine counter element not found (Minesweeper not open)");
    }

    const timerEl = document.getElementById("minesweeper-timer");
    if (timerEl) {
      results.push("PASS - Timer element found");
    } else {
      results.push("SKIP - Timer element not found (Minesweeper not open)");
    }

    const faceBtn = document.getElementById("minesweeper-face-btn");
    if (faceBtn) {
      results.push("PASS - Face button element found");
    } else {
      results.push("SKIP - Face button element not found (Minesweeper not open)");
    }

    const gridEl = document.getElementById("minesweeper-grid");
    if (gridEl) {
      results.push("PASS - Grid element found");
    } else {
      results.push("SKIP - Grid element not found (Minesweeper not open)");
    }

    // Test 20: Verify UI elements have correct initial values when open
    if (mineCounterEl) {
      if (mineCounterEl.textContent === "010") {
        results.push("PASS - Mine counter shows 010 (10 mines for beginner)");
      } else {
        results.push("FAIL - Mine counter shows: " + mineCounterEl.textContent);
      }
    }

    if (timerEl) {
      if (timerEl.textContent === "000") {
        results.push("PASS - Timer shows 000 (not running)");
      } else {
        results.push("FAIL - Timer shows: " + timerEl.textContent);
      }
    }

    if (faceBtn) {
      if (faceBtn.textContent === "\u{1F600}") {
        results.push("PASS - Face button shows smiley (😊) when not playing");
      } else {
        results.push("FAIL - Face button shows: " + faceBtn.textContent);
      }
    }

    // Test 21: Verify flag placement and mine counter update
    if (gridEl) {
      const cells = gridEl.querySelectorAll(".mine-cell");
      if (cells.length > 0) {
        const firstCell = cells[0];
        firstCell.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
        const counterAfterFlag = document.getElementById("minesweeper-mine-counter");
        if (counterAfterFlag && counterAfterFlag.textContent === "009") {
          results.push("PASS - Flag placement decrements mine counter (010 → 009)");
        } else if (!counterAfterFlag) {
          results.push("FAIL - Mine counter element not found after flag");
        } else {
          results.push("FAIL - Mine counter after flag: " + counterAfterFlag.textContent + " (expected 009)");
        }
        // Unflag by clicking again
        firstCell.dispatchEvent(new MouseEvent("contextmenu", {bubbles: true, cancelable: true}));
        const counterAfterUnflag = document.getElementById("minesweeper-mine-counter");
        if (counterAfterUnflag && counterAfterUnflag.textContent === "010") {
          results.push("PASS - Unflag placement increments mine counter (009 → 010)");
        } else if (!counterAfterUnflag) {
          results.push("FAIL - Mine counter element not found after unflag");
        } else {
          results.push("FAIL - Mine counter after unflag: " + counterAfterUnflag.textContent + " (expected 010)");
        }
      } else {
        results.push("SKIP - No cells in grid for flag test");
      }
    }

    // Test 22: Verify overlay shows on game over
    if (gridEl) {
      // Click a cell to start the game
      const firstCell = gridEl.querySelectorAll(".mine-cell")[0];
      firstCell.dispatchEvent(new MouseEvent("click", {bubbles: true}));
      const overlay = document.getElementById("minesweeper-overlay");
      if (overlay && overlay.style.display === "none") {
        results.push("PASS - Overlay hidden when game is active");
      } else if (!overlay) {
        results.push("SKIP - Overlay element not found");
      } else {
        results.push("FAIL - Overlay visible when game is active");
      }
    }

  } catch (e) {
    results.push("FAIL - Self-test error: " + e.message);
  }

  // Output results
  console.log("=== Minesweeper Self-Test ===");
  results.forEach(r => console.log(r));
  console.log("============================");

  return results;
}

/**
 * Initialize the Minesweeper game.
 */
function initMinesweeper(container, windowId) {
  container.innerHTML = "";

  // Set window ID for keyboard handling
  if (windowId) {
    container.closest(".window").id = windowId;
  }

  // Main container
  const main = document.createElement("div");
  main.id = "minesweeper-content";

  // Difficulty selector
  const controls = document.createElement("div");
  controls.className = "minesweeper-controls";

  const difficultyGroup = document.createElement("div");
  difficultyGroup.className = "minesweeper-difficulty-group";

  for (const key of Object.keys(MINESWEEPER_DIFFICULTIES)) {
    const btn = document.createElement("button");
    btn.className = "minesweeper-difficulty-btn";
    btn.dataset.difficulty = key;
    const diff = MINESWEEPER_DIFFICULTIES[key];
    btn.textContent = key.charAt(0).toUpperCase() + key.slice(1) + " (" + diff.cols + "x" + diff.rows + ", " + diff.mines + ")";
    btn.addEventListener("click", () => handleDifficultyChange(key));
    difficultyGroup.appendChild(btn);
  }

  controls.appendChild(difficultyGroup);

  // Status bar
  const statusBar = document.createElement("div");
  statusBar.className = "minesweeper-status-bar";

  // Mine counter
  const mineCounter = document.createElement("div");
  mineCounter.className = "minesweeper-counter mine-count";
  mineCounter.id = "minesweeper-mine-counter";
  mineCounter.textContent = "010";

  // Face button
  const faceBtn = document.createElement("button");
  faceBtn.className = "minesweeper-face-btn";
  faceBtn.id = "minesweeper-face-btn";
  faceBtn.textContent = "\u{1F600}"; // 😊
  faceBtn.addEventListener("click", () => restartGame());

  // Timer
  const timerEl = document.createElement("div");
  timerEl.className = "minesweeper-counter timer";
  timerEl.id = "minesweeper-timer";
  timerEl.textContent = "000";

  statusBar.appendChild(mineCounter);
  statusBar.appendChild(faceBtn);
  statusBar.appendChild(timerEl);

  // Game container (holds grid + overlay)
  const gameContainer = document.createElement("div");
  gameContainer.className = "minesweeper-game-container";

  // Grid will be placed here
  const gridEl = document.createElement("div");
  gridEl.id = "minesweeper-grid";
  gridEl.className = "minesweeper-grid";
  gameContainer.appendChild(gridEl);

  // Overlay (shown on win/lose)
  const overlay = document.createElement("div");
  overlay.className = "minesweeper-overlay";
  overlay.id = "minesweeper-overlay";
  overlay.style.display = "none";
  gameContainer.appendChild(overlay);

  main.appendChild(controls);
  main.appendChild(statusBar);
  main.appendChild(gameContainer);
  container.appendChild(main);

  // Start a new game
  startNewGame();
}

/**
 * Handle difficulty change.
 */
function handleDifficultyChange(difficulty) {
  minesweeperState.currentDifficulty = difficulty;

  // Update active button
  document.querySelectorAll(".minesweeper-difficulty-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.difficulty === difficulty);
  });

  restartGame();
}

/**
 * Calculate the number of neighboring mines for a cell.
 */
function countNeighbors(board, rows, cols, row, col) {
  let count = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].isMine) {
        count++;
      }
    }
  }
  return count;
}

/**
 * Create the board data structure.
 */
function createBoard(rows, cols) {
  const board = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        isMine: false,
        revealed: false,
        flagged: false,
        neighborCount: 0,
      });
    }
    board.push(row);
  }
  return board;
}

/**
 * Place mines on the board, avoiding the first-click safe zone.
 * A cell and its 8 neighbors are always safe after the first click.
 */
function placeMines(board, rows, cols, mineCount, safeRow, safeCol) {
  const safeCells = new Set();
  // The clicked cell and its neighbors are always safe
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = safeRow + dr;
      const nc = safeCol + dc;
      if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
        safeCells.add(nr * cols + nc);
      }
    }
  }

  let placed = 0;
  const totalCells = rows * cols;

  while (placed < mineCount) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    const idx = r * cols + c;

    if (board[r][c].isMine) continue;
    if (safeCells.has(idx)) continue;

    board[r][c].isMine = true;
    placed++;
  }

  // Calculate neighbor counts
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (board[r][c].isMine) continue;
      board[r][c].neighborCount = countNeighbors(board, rows, cols, r, c);
    }
  }
}

/**
 * Flood fill: reveal an empty cell and its neighbors recursively.
 */
function floodReveal(board, rows, cols, row, col) {
  if (row < 0 || row >= rows || col < 0 || col >= cols) return;
  const cell = board[row][col];
  if (cell.revealed || cell.flagged) return;

  cell.revealed = true;
  minesweeperState.revealedCount++;

  // If empty (0 neighbors), flood fill neighbors
  if (cell.neighborCount === 0 && !cell.isMine) {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        floodReveal(board, rows, cols, row + dr, col + dc);
      }
    }
  }
}

/**
 * Start a new game with the current difficulty.
 */
function startNewGame() {
  const diff = MINESWEEPER_DIFFICULTIES[minesweeperState.currentDifficulty];
  const rows = diff.rows;
  const cols = diff.cols;
  const mineCount = diff.mines;

  // Clear any existing timer
  if (minesweeperState.timerInterval) {
    clearInterval(minesweeperState.timerInterval);
    minesweeperState.timerInterval = null;
  }

  // Reset state
  minesweeperState.board = createBoard(rows, cols);
  minesweeperState.gameOver = false;
  minesweeperState.firstClick = true;
  minesweeperState.started = false;
  minesweeperState.timeElapsed = 0;
  minesweeperState.minesPlaced = false;
  minesweeperState.revealedCount = 0;

  // Update UI
  updateMineCounter();
  updateTimer();
  updateFaceBtn();
  hideOverlay();

  // Build the grid
  buildGrid(rows, cols);
}

/**
 * Build the minesweeper grid in the DOM.
 */
function buildGrid(rows, cols) {
  const grid = document.getElementById("minesweeper-grid");
  if (!grid) return;

  grid.innerHTML = "";
  grid.style.gridTemplateColumns = "repeat(" + cols + ", 28px)";
  grid.style.gridTemplateRows = "repeat(" + rows + ", 28px)";

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = document.createElement("div");
      cell.className = "mine-cell";
      cell.dataset.row = r;
      cell.dataset.col = c;

      // Left click: reveal
      cell.addEventListener("click", (e) => handleCellClick(r, c));

      // Right click: flag
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        handleRightClick(r, c);
      });

      grid.appendChild(cell);
    }
  }
}

/**
 * Handle a left click on a cell.
 */
function handleCellClick(row, col) {
  if (minesweeperState.gameOver) return;

  const board = minesweeperState.board;
  const rows = board.length;
  const cols = board[0].length;
  const cell = board[row][col];

  // If flagged, do nothing
  if (cell.flagged) return;

  // First click: place mines, start timer
  if (minesweeperState.firstClick) {
    minesweeperState.firstClick = false;
    minesweeperState.started = true;
    minesweeperState.minesPlaced = true;
    placeMines(board, rows, cols, MINESWEEPER_DIFFICULTIES[minesweeperState.currentDifficulty].mines, row, col);
    startTimer();
    updateFaceBtn();
  }

  // If it's a mine, game over
  if (cell.isMine) {
    cell.revealed = true;
    gameOver(false);
    return;
  }

  // Reveal the cell
  revealCell(row, col);

  // Update face button during gameplay
  if (!minesweeperState.gameOver && minesweeperState.started) {
    updateFaceBtn();
  }

  // Check for win
  checkWin();
}

/**
 * Reveal a cell and flood fill if empty.
 */
function revealCell(row, col) {
  const board = minesweeperState.board;
  const rows = board.length;
  const cols = board[0].length;

  floodReveal(board, rows, cols, row, col);
  updateGridDisplay();
}

/**
 * Handle a right click on a cell (toggle flag).
 */
function handleRightClick(row, col) {
  if (minesweeperState.gameOver) return;

  const board = minesweeperState.board;
  const cell = board[row][col];

  // If already revealed, do nothing
  if (cell.revealed) return;

  // Toggle flag
  cell.flagged = !cell.flagged;

  // Update UI
  updateGridDisplay();
  updateMineCounter();
}

/**
 * Update the grid display to match the board state.
 */
function updateGridDisplay() {
  const board = minesweeperState.board;
  const rows = board.length;
  const cols = board[0].length;
  const grid = document.getElementById("minesweeper-grid");
  if (!grid) return;

  const cells = grid.querySelectorAll(".mine-cell");

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = board[r][c];
      const idx = r * cols + c;
      const cellEl = cells[idx];
      if (!cellEl) continue;

      // Reset classes
      cellEl.className = "mine-cell";
      cellEl.textContent = "";

      if (cell.revealed && cell.isMine) {
        cellEl.classList.add("revealed", "mine");
        if (minesweeperState.gameOver) {
          // On game over, show mines
          cellEl.innerHTML = "<span class=\"mine-icon\">💣</span>";
        }
      } else if (cell.revealed && !cell.isMine) {
        cellEl.classList.add("revealed");
        if (cell.neighborCount > 0) {
          cellEl.setAttribute("data-neighbor", String(cell.neighborCount));
          cellEl.textContent = String(cell.neighborCount);
        }
      } else if (cell.flagged) {
        cellEl.innerHTML = "<span class=\"flag-icon\">🚩</span>";
      }
    }
  }
}

/**
 * Check if the player has won.
 */
function checkWin() {
  const board = minesweeperState.board;
  const rows = board.length;
  const cols = board[0].length;
  const totalSafeCells = rows * cols - MINESWEEPER_DIFFICULTIES[minesweeperState.currentDifficulty].mines;

  if (minesweeperState.revealedCount === totalSafeCells) {
    gameOver(true);
  }
}

/**
 * Handle game over (win or lose).
 */
function gameOver(won) {
  minesweeperState.gameOver = true;
  minesweeperState.started = false;

  // Stop the timer
  if (minesweeperState.timerInterval) {
    clearInterval(minesweeperState.timerInterval);
    minesweeperState.timerInterval = null;
  }

  // Reveal all mines on loss
  if (!won) {
    const board = minesweeperState.board;
    const rows = board.length;
    const cols = board[0].length;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = board[r][c];
        if (cell.isMine && !cell.flagged) {
          cell.revealed = true;
        }
        // Also show incorrectly placed flags
        if (cell.flagged && !cell.isMine) {
          cell.revealed = true;
        }
      }
    }
  }

  // Update grid
  updateGridDisplay();
  updateFaceBtn();

  // Show overlay
  showOverlay(won);
}

/**
 * Update the mine counter display.
 */
function updateMineCounter() {
  const counter = document.getElementById("minesweeper-mine-counter");
  if (!counter) return;

  const board = minesweeperState.board;
  const rows = board ? board.length : 0;
  const cols = board ? board[0].length : 0;
  const mineCount = MINESWEEPER_DIFFICULTIES[minesweeperState.currentDifficulty].mines;

  // Count flags
  let flagCount = 0;
  if (rows > 0 && cols > 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (board[r][c].flagged) flagCount++;
      }
    }
  }

  const remaining = mineCount - flagCount;
  const display = String(Math.abs(remaining)).padStart(3, "0");
  counter.textContent = remaining < 0 ? "-" + String(Math.abs(remaining)).padStart(2, "0") : display;
}

/**
 * Update the timer display.
 */
function updateTimer() {
  const timerEl = document.getElementById("minesweeper-timer");
  if (!timerEl) return;
  const display = String(Math.min(minesweeperState.timeElapsed, 999)).padStart(3, "0");
  timerEl.textContent = display;
}

/**
 * Start the game timer.
 */
function startTimer() {
  if (minesweeperState.timerInterval) return;
  minesweeperState.timerInterval = setInterval(() => {
    if (minesweeperState.started && !minesweeperState.gameOver) {
      minesweeperState.timeElapsed++;
      updateTimer();
    }
  }, 1000);
}

/**
 * Update the face button based on game state.
 */
function updateFaceBtn() {
  const faceBtn = document.getElementById("minesweeper-face-btn");
  if (!faceBtn) return;

  if (minesweeperState.gameOver) {
    // Find the state
    const board = minesweeperState.board;
    if (board) {
      const rows = board.length;
      const cols = board[0].length;
      let lost = false;
      for (let r = 0; r < rows && !lost; r++) {
        for (let c = 0; c < cols && !lost; c++) {
          if (board[r][c].revealed && board[r][c].isMine) {
            lost = true;
          }
        }
      }
      faceBtn.textContent = lost ? "\u{1F61E}" : "\u{1F60E}"; // 😞 or 😎
    }
  } else if (minesweeperState.started && !minesweeperState.gameOver) {
    faceBtn.textContent = "\u{1F631}"; // 😱 (running)
  } else {
    faceBtn.textContent = "\u{1F600}"; // 😊
  }
}

/**
 * Restart the game with current difficulty.
 */
function restartGame() {
  startNewGame();
}

/**
 * Show the win/lose overlay.
 */
function showOverlay(won) {
  const overlay = document.getElementById("minesweeper-overlay");
  if (!overlay) return;

  overlay.style.display = "flex";

  const content = document.createElement("div");
  content.className = "minesweeper-overlay-content";

  const h2 = document.createElement("h2");
  h2.textContent = won ? "🎉 You Win!" : "💥 Game Over";

  const p = document.createElement("p");
  p.textContent = won ? "Congratulations! You found all the mines." : "You hit a mine. Try again!";

  const btn = document.createElement("button");
  btn.textContent = "New Game";
  btn.addEventListener("click", () => {
    hideOverlay();
    startNewGame();
  });

  content.appendChild(h2);
  content.appendChild(p);
  content.appendChild(btn);

  overlay.innerHTML = "";
  overlay.appendChild(content);
}

/**
 * Hide the win/lose overlay.
 */
function hideOverlay() {
  const overlay = document.getElementById("minesweeper-overlay");
  if (overlay) overlay.style.display = "none";
}

// ============================================================
// SECTION 13: Spider Solitaire
// ============================================================

const SPIDER_RANK_VALUES = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13 };

function rankFromValue(value) {
  for (const [rank, v] of Object.entries(SPIDER_RANK_VALUES)) {
    if (v === value) return rank;
  }
  return "?";
}

function suitDisplay() {
  return "♠";
}

function createDeck() {
  const deck = [];
  for (let i = 1; i <= 13; i++) {
    deck.push({ rank: i, faceUp: false });
    deck.push({ rank: i, faceUp: false });
  }
  return deck;
}

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const spiderState = {
  columns: null,
  stock: [],
  completedRuns: 0,
  gameOver: false,
  dragSource: null,
  dragCards: null,
  dragTargetColumn: null,
};

window.Spider = spiderState;

function dealCards() {
  spiderState.columns = [];
  spiderState.completedRuns = 0;
  spiderState.gameOver = false;
  spiderState.dragSource = null;
  spiderState.dragCards = null;
  spiderState.dragTargetColumn = null;

  const deck = shuffleArray(createDeck());
  let cardIdx = 0;

  for (let col = 0; col < 10; col++) {
    const numCards = col < 4 ? 6 : 5;
    const column = [];
    for (let i = 0; i < numCards; i++) {
      const card = deck[cardIdx++];
      card.faceUp = (i === numCards - 1);
      column.push(card);
    }
    spiderState.columns.push(column);
  }

  spiderState.stock = deck.slice(cardIdx);
}

function dealStock() {
  if (spiderState.stock.length < 10) return false;
  for (let col = 0; col < 10; col++) {
    if (spiderState.columns[col].length === 0) return false;
  }
  for (let col = 0; col < 10; col++) {
    const card = spiderState.stock.shift();
    card.faceUp = true;
    spiderState.columns[col].push(card);
  }
  return true;
}

function checkCompleteRun(column) {
  if (column.length < 13) return false;
  for (let i = 1; i <= 13; i++) {
    const card = column[column.length - i];
    if (!card || !card.faceUp || card.rank !== 14 - i) return false;
  }
  return true;
}

function removeCompleteRun(colIndex) {
  const column = spiderState.columns[colIndex];
  if (!checkCompleteRun(column)) return false;
  for (let i = 0; i < 13; i++) {
    column.pop();
  }
  spiderState.completedRuns++;
  autoFlipColumn(column);
  return true;
}

function getDescSequence(column, cardIndex) {
  const sequence = [];
  for (let i = cardIndex; i < column.length; i++) {
    if (!column[i].faceUp) break;
    if (i > cardIndex && column[i].rank >= column[i - 1].rank) break;
    sequence.push(column[i]);
  }
  return sequence;
}

function canMoveToColumn(sourceCol, sourceStart, targetCol, targetEnd) {
  if (sourceCol.length === 0 || sourceStart < 0) return false;
  const sequence = getDescSequence(sourceCol, sourceStart);
  if (sequence.length < 1) return false;
  if (targetCol.length === 0) return true;
  const targetCard = targetCol[targetEnd];
  return targetCard.rank === sequence[0].rank + 1;
}

function moveCards(sourceCol, sourceStart, targetCol) {
  const sequence = getDescSequence(sourceCol, sourceStart);
  for (let i = 0; i < sequence.length; i++) {
    sourceCol.pop();
  }
  for (const card of sequence) {
    targetCol.push(card);
  }
  autoFlipColumn(sourceCol);
}

function autoFlipColumn(column) {
  for (let i = column.length - 1; i >= 0; i--) {
    if (!column[i].faceUp) {
      column[i].faceUp = true;
      break;
    }
  }
}

function checkWin() {
  return spiderState.completedRuns >= 8;
}

function handleCardClick(colIndex, cardIndex) {
  if (spiderState.gameOver) return;
  if (spiderState.dragSource && spiderState.dragSource.column === colIndex) {
    deselectCards();
    return;
  }
  const column = spiderState.columns[colIndex];
  if (!column || !column[cardIndex].faceUp) return;
  const sequence = getDescSequence(column, cardIndex);
  if (sequence.length < 1) return;
  spiderState.dragSource = { column: colIndex, startCardIndex: cardIndex };
  spiderState.dragCards = sequence;
  renderSpiderGame();
}

function deselectCards() {
  spiderState.dragSource = null;
  spiderState.dragCards = null;
  spiderState.dragTargetColumn = null;
  renderSpiderGame();
}

function handleDropOnColumn(colIndex) {
  if (!spiderState.dragSource || spiderState.dragSource.column === colIndex) {
    deselectCards();
    return;
  }
  const sourceCol = spiderState.columns[spiderState.dragSource.column];
  const targetCol = spiderState.columns[colIndex];
  const sourceStart = spiderState.dragSource.startCardIndex;
  if (canMoveToColumn(sourceCol, sourceStart, targetCol, targetCol.length - 1)) {
    moveCards(sourceCol, sourceStart, targetCol);
    deselectCards();
    removeCompleteRun(colIndex);
    if (checkWin()) {
      spiderState.gameOver = true;
      showSpiderWinOverlay();
    }
  } else {
    deselectCards();
  }
}

function renderSpiderGame() {
  const container = document.getElementById("spider-game-container");
  if (!container) return;
  container.innerHTML = "";

  for (let col = 0; col < 10; col++) {
    const colEl = document.createElement("div");
    colEl.className = "spider-column";
    colEl.dataset.column = col;

    const dropZone = document.createElement("div");
    dropZone.className = "spider-column-drop-zone";
    if (spiderState.dragTargetColumn === col) {
      dropZone.classList.add("drag-over");
    }
    colEl.appendChild(dropZone);

    const column = spiderState.columns[col];
    if (column) {
      for (let i = 0; i < column.length; i++) {
        const card = column[i];
        const cardEl = document.createElement("div");
        cardEl.className = "spider-card " + (card.faceUp ? "face-up" : "face-down");
        cardEl.dataset.column = col;
        cardEl.dataset.cardIndex = i;

        if (spiderState.dragCards && spiderState.dragSource) {
          if (spiderState.dragSource.column === col && i >= spiderState.dragSource.startCardIndex) {
            cardEl.classList.add("selected");
          }
        }

        if (card.faceUp) {
          cardEl.innerHTML = '<span class="card-rank">' + rankFromValue(card.rank) + '</span><span class="card-suit">' + suitDisplay() + '</span>';
        }

        cardEl.addEventListener("mousedown", (e) => {
          e.preventDefault();
          handleCardClick(col, i);
        });

        cardEl.addEventListener("dragstart", (e) => {
          e.preventDefault();
          handleCardClick(col, i);
        });

        cardEl.addEventListener("dragover", (e) => {
          e.preventDefault();
          spiderState.dragTargetColumn = col;
          cardEl.classList.add("drag-over");
        });

        cardEl.addEventListener("dragleave", () => {
          spiderState.dragTargetColumn = null;
          cardEl.classList.remove("drag-over");
        });

        cardEl.addEventListener("dragenter", (e) => {
          e.preventDefault();
          spiderState.dragTargetColumn = col;
        });

        cardEl.addEventListener("drop", (e) => {
          e.preventDefault();
          handleDropOnColumn(col);
        });

        container.appendChild(cardEl);
      }
    }
    document.getElementById("spider-content").appendChild(colEl);
  }

  const stockCount = document.getElementById("spider-stock-count");
  if (stockCount) stockCount.textContent = String(spiderState.stock.length);

  const dealBtn = document.getElementById("spider-deal-btn");
  if (dealBtn) {
    dealBtn.disabled = spiderState.stock.length < 10 || spiderState.gameOver;
  }
}

function showSpiderWinOverlay() {
  const gameContainer = document.getElementById("spider-game-container");
  if (!gameContainer) return;
  let overlay = gameContainer.querySelector(".spider-overlay");
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.className = "spider-overlay";
  const content = document.createElement("div");
  content.className = "spider-overlay-content";
  const h2 = document.createElement("h2");
  h2.textContent = "🎉 You Win!";
  const p = document.createElement("p");
  p.textContent = "Congratulations! All 8 runs completed.";
  const btn = document.createElement("button");
  btn.textContent = "New Game";
  btn.addEventListener("click", () => {
    hideSpiderOverlay();
    initSpiderGame();
  });
  content.appendChild(h2);
  content.appendChild(p);
  content.appendChild(btn);
  overlay.appendChild(content);
  gameContainer.appendChild(overlay);
}

function hideSpiderOverlay() {
  const container = document.getElementById("spider-game-container");
  if (!container) return;
  const overlay = container.querySelector(".spider-overlay");
  if (overlay) overlay.remove();
}

function handleDealStock() {
  if (spiderState.gameOver) return;
  if (spiderState.stock.length >= 10 && dealStock()) {
    renderSpiderGame();
    for (let col = 0; col < 10; col++) {
      while (removeCompleteRun(col)) { }
    }
    if (checkWin()) {
      spiderState.gameOver = true;
      showSpiderWinOverlay();
    }
  }
}

function initSpiderGame(container, windowId) {
  container.innerHTML = "";
  if (windowId) {
    container.closest(".window").id = windowId;
  }

  const main = document.createElement("div");
  main.id = "spider-content";

  const topBar = document.createElement("div");
  topBar.className = "spider-top-bar";

  const title = document.createElement("span");
  title.className = "spider-top-bar-title";
  title.textContent = "♠ Spider Solitaire";
  topBar.appendChild(title);

  const newGameBtn = document.createElement("button");
  newGameBtn.className = "spider-new-game-btn";
  newGameBtn.textContent = "New Game";
  newGameBtn.addEventListener("click", () => {
    initSpiderGame(container, windowId);
  });
  topBar.appendChild(newGameBtn);

  const stockArea = document.createElement("div");
  stockArea.className = "spider-stock-area";

  const stockCount = document.createElement("span");
  stockCount.className = "spider-stock-count";
  stockCount.id = "spider-stock-count";
  stockCount.textContent = "50";
  stockArea.appendChild(stockCount);

  const dealBtn = document.createElement("button");
  dealBtn.className = "spider-stock-btn deal";
  dealBtn.id = "spider-deal-btn";
  dealBtn.textContent = "Deal";
  dealBtn.disabled = true;
  dealBtn.addEventListener("click", () => handleDealStock());
  stockArea.appendChild(dealBtn);

  topBar.appendChild(stockArea);
  main.appendChild(topBar);

  const gameContainer = document.createElement("div");
  gameContainer.className = "spider-game-container";
  gameContainer.id = "spider-game-container";
  main.appendChild(gameContainer);

  container.appendChild(main);

  dealCards();
  renderSpiderGame();
}

function runSpiderSelfTest() {
  const results = [];

  try {
    // Test 1: Verify state exists on window
    if (window.Spider !== undefined) {
      results.push("PASS - Spider state exposed on window");
    } else {
      results.push("FAIL - Spider state not on window");
    }

    // Test 2: Verify deck creation - 104 cards
    const deck = createDeck();
    if (deck.length === 104) {
      results.push("PASS - Deck has 104 cards (two suits of spades)");
    } else {
      results.push("FAIL - Deck has " + deck.length + " cards (expected 104)");
    }

    // Test 3: Verify two of each rank
    const rankCounts = {};
    for (const card of deck) {
      rankCounts[card.rank] = (rankCounts[card.rank] || 0) + 1;
    }
    let allRanksHaveTwo = true;
    for (let i = 1; i <= 13; i++) {
      if (rankCounts[i] !== 2) {
        allRanksHaveTwo = false;
        break;
      }
    }
    if (allRanksHaveTwo) {
      results.push("PASS - Each rank appears twice (two suits)");
    } else {
      results.push("FAIL - Not all ranks have two copies");
    }

    // Test 4: Verify rank display function
    if (rankFromValue(1) === "A" && rankFromValue(13) === "K" && rankFromValue(10) === "10") {
      results.push("PASS - Rank display function works correctly");
    } else {
      results.push("FAIL - Rank display: A=" + rankFromValue(1) + ", K=" + rankFromValue(13) + ", 10=" + rankFromValue(10));
    }

    // Test 5: Verify deck is shuffled (different order)
    const deck1 = createDeck();
    const deck2 = createDeck();
    let allSame = true;
    for (let i = 0; i < deck1.length && allSame; i++) {
      if (deck1[i].rank !== deck2[i].rank) {
        allSame = false;
      }
    }
    if (!allSame) {
      results.push("PASS - Deck shuffling produces different orders");
    } else {
      results.push("FAIL - Deck shuffling not working");
    }

    // Test 6: Verify deal function creates 10 columns with correct distribution
    dealCards();
    const columns = Spider.columns;
    if (columns && columns.length === 10) {
      let totalCards = 0;
      for (const col of columns) {
        totalCards += col.length;
      }
      if (totalCards === 54) {
        results.push("PASS - Deal: 54 cards dealt (4×6 + 6×5), 54 in stock");
      } else {
        results.push("FAIL - Deal: " + totalCards + " cards dealt (expected 54)");
      }
    } else {
      results.push("FAIL - Deal: columns not created correctly");
    }

    // Test 7: Verify stock has 50 cards after deal
    if (Spider.stock.length === 50) {
      results.push("PASS - Stock has 50 cards after initial deal");
    } else {
      results.push("FAIL - Stock has " + Spider.stock.length + " cards (expected 50)");
    }

    // Test 8: Verify top card of each column is face-up
    let allTopCardsFaceUp = true;
    for (let col = 0; col < 10 && allTopCardsFaceUp; col++) {
      if (columns[col].length > 0) {
        const topCard = columns[col][columns[col].length - 1];
        if (topCard.faceUp !== true) {
          allTopCardsFaceUp = false;
        }
      }
    }
    if (allTopCardsFaceUp) {
      results.push("PASS - Top card of each column is face-up");
    } else {
      results.push("FAIL - Not all top cards are face-up");
    }

    // Test 9: Verify stock deal when columns are not empty
    if (Spider.stock.length > 0) {
      dealStock();
      if (Spider.stock.length === 40 && Spider.columns.every(col => col.length > 0)) {
        let totalStocked = 0;
        for (const col of Spider.columns) {
          totalStocked += col[col.length - 1].faceUp ? 1 : 0;
        }
        if (totalStocked === 10) {
          results.push("PASS - Stock deal: 10 cards dealt face-up");
        } else {
          results.push("FAIL - Stock deal: " + totalStocked + " face-up cards dealt (expected 10)");
        }
      } else {
        results.push("FAIL - Stock deal failed");
      }
    } else {
      results.push("FAIL - Stock empty before stock deal");
    }

    // Test 10: Verify stock deal blocked when a column is empty
    spiderState.columns = null;
    spiderState.stock = [];
    dealCards();
    const col0 = Spider.columns[0];
    const removedCard = col0.pop();
    if (col0.length > 0) {
      col0[col0.length - 1].faceUp = true;
    }
    dealStock();
    if (Spider.stock.length === 50) {
      results.push("PASS - Stock deal blocked when column is empty");
    } else {
      results.push("FAIL - Stock was dealt when column was empty");
    }
    col0.push(removedCard);

    // Test 11: Verify descending sequence detection
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    const testCol = [
      { rank: 5, faceUp: false },
      { rank: 6, faceUp: false },
      { rank: 7, faceUp: true },
      { rank: 6, faceUp: true },
      { rank: 5, faceUp: true },
    ];
    spiderState.columns[0] = testCol;
    const descSequence = getDescSequence(testCol, 5);
    if (descSequence.length === 3 && descSequence[0].rank === 5 && descSequence[2].rank === 7) {
      results.push("PASS - Descending sequence detection works");
    } else {
      results.push("FAIL - Descending sequence: " + JSON.stringify(descSequence.map(c => c.rank)));
    }

    // Test 12: Verify move to higher rank allowed
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    spiderState.columns[0] = [
      { rank: 5, faceUp: true },
      { rank: 4, faceUp: true },
    ];
    spiderState.columns[1] = [
      { rank: 6, faceUp: true },
    ];
    const canMoveToHigher = canMoveToColumn(spiderState.columns[0], 1, spiderState.columns[1], 0);
    if (canMoveToHigher) {
      results.push("PASS - Move to higher rank (5 on 6) allowed");
    } else {
      results.push("FAIL - Move to higher rank rejected");
    }

    // Test 13: Verify illegal move rejected
    const canMoveToLower = canMoveToColumn(spiderState.columns[1], 0, spiderState.columns[0], 1);
    if (!canMoveToLower) {
      results.push("PASS - Move to lower rank (6 on 5) rejected");
    } else {
      results.push("FAIL - Move to lower rank was allowed");
    }

    // Test 14: Verify auto-flip
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    spiderState.columns[0] = [
      { rank: 3, faceUp: false },
      { rank: 4, faceUp: true },
    ];
    autoFlipColumn(spiderState.columns[0]);
    if (spiderState.columns[0][0].faceUp === true) {
      results.push("PASS - Auto-flip exposes face-down card");
    } else {
      results.push("FAIL - Face-down card not auto-flipped");
    }

    // Test 15: Verify win detection
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    spiderState.completedRuns = 8;
    const won = checkWin();
    if (won) {
      results.push("PASS - Win detected when 8 runs completed");
    } else {
      results.push("FAIL - Win not detected");
    }

    // Test 16: Verify no win with 7 runs
    spiderState.completedRuns = 7;
    const notWon = checkWin();
    if (!notWon) {
      results.push("PASS - No win with 7 runs completed");
    } else {
      results.push("FAIL - False win with 7 runs");
    }

    // Test 17: Verify King→Ace run detected
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    const runCol = [];
    for (let i = 1; i <= 13; i++) {
      runCol.push({ rank: i, faceUp: true });
    }
    spiderState.columns[0] = runCol;
    const hasRun = checkCompleteRun(spiderState.columns[0]);
    if (hasRun) {
      results.push("PASS - King→Ace run detected");
    } else {
      results.push("FAIL - King→Ace run not detected");
    }

    // Test 18: Verify incomplete run not removed
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    const partialRun = [];
    for (let i = 2; i <= 13; i++) {
      partialRun.push({ rank: i, faceUp: true });
    }
    spiderState.columns[0] = partialRun;
    const partialHasRun = checkCompleteRun(spiderState.columns[0]);
    if (!partialHasRun) {
      results.push("PASS - Incomplete run (no Ace) not removed");
    } else {
      results.push("FAIL - Incomplete run was removed");
    }

    // Test 19: Verify moveCards correctly moves a sequence
    spiderState.columns = [null, null, null, null, null, null, null, null, null, null];
    spiderState.columns[0] = [
      { rank: 5, faceUp: true },
      { rank: 4, faceUp: true },
      { rank: 3, faceUp: true },
    ];
    spiderState.columns[1] = [
      { rank: 6, faceUp: true },
    ];
    moveCards(spiderState.columns[0], 0, spiderState.columns[1]);
    if (spiderState.columns[0].length === 0 && spiderState.columns[1].length === 4) {
      if (spiderState.columns[1][1].rank === 5 && spiderState.columns[1][2].rank === 4 && spiderState.columns[1][3].rank === 3) {
        results.push("PASS - moveCards moves sequence correctly");
      } else {
        results.push("FAIL - moveCards sequence order wrong");
      }
    } else {
      results.push("FAIL - moveCards wrong lengths: src=" + spiderState.columns[0].length + ", tgt=" + spiderState.columns[1].length);
    }

    // Test 20: Verify UI elements exist when Spider is open
    const stockCountEl = document.getElementById("spider-stock-count");
    if (stockCountEl) {
      results.push("PASS - Stock count element found");
    } else {
      results.push("SKIP - Stock count element not found (Spider not open)");
    }

    const dealBtnEl = document.getElementById("spider-deal-btn");
    if (dealBtnEl) {
      results.push("PASS - Deal button element found");
    } else {
      results.push("SKIP - Deal button element not found (Spider not open)");
    }

    const gameContainerEl = document.getElementById("spider-game-container");
    if (gameContainerEl) {
      results.push("PASS - Game container element found");
    } else {
      results.push("SKIP - Game container element not found (Spider not open)");
    }

    // Test 21: Verify UI elements have correct initial values when open
    if (stockCountEl) {
      if (stockCountEl.textContent === "50") {
        results.push("PASS - Stock count shows 50 (50 cards in stock)");
      } else {
        results.push("FAIL - Stock count shows: " + stockCountEl.textContent);
      }
    }

    if (dealBtnEl) {
      if (dealBtnEl.disabled) {
        results.push("PASS - Deal button is disabled (cannot deal when stock has 50 cards)");
      } else {
        results.push("FAIL - Deal button should be disabled when stock has 50 cards");
      }
    }

    // Test 22: Verify card elements are rendered with correct ranks
    if (gameContainerEl) {
      const cardEls = gameContainerEl.querySelectorAll(".spider-card");
      if (cardEls.length > 0) {
        const faceUpCards = Array.from(cardEls).filter(el => el.classList.contains("face-up"));
        if (faceUpCards.length === 10) {
          results.push("PASS - 10 face-up cards rendered (one per column)");
        } else {
          results.push("FAIL - Expected 10 face-up cards, got " + faceUpCards.length);
        }
      } else {
        results.push("SKIP - No face-up card elements found");
      }
    }

  } catch (e) {
    results.push("FAIL - Self-test error: " + e.message);
  }

  console.log("=== Spider Solitaire Self-Test ===");
  results.forEach(r => console.log(r));
  console.log("=================================");

  return results;
}

document.addEventListener("DOMContentLoaded", () => {
  init();

  // Close context menu / wallpaper picker on outside click
  document.addEventListener("click", (e) => {
    hideContextMenu();
    hideWallpaperPicker();
  });

  // Prevent context menu on the desktop
  document.getElementById("desktop").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY);
  });
});
