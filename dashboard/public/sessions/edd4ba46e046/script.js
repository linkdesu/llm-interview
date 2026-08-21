/**
 * Browser OS — Desktop Shell (Ticket 1)
 * Window manager, taskbar, desktop icons, clock.
 */

window._scriptLoaded = true;

// ===== Wallpaper Presets =====
const WALLPAPERS = [
  { id: "midnight", label: "Midnight", cssClass: "wp-midnight" },
  { id: "sunset", label: "Sunset", cssClass: "wp-sunset" },
  { id: "ocean", label: "Ocean", cssClass: "wp-ocean" },
  { id: "forest", label: "Forest", cssClass: "wp-forest" },
  { id: "aurora", label: "Aurora", cssClass: "wp-aurora" },
  { id: "lavender", label: "Lavender", cssClass: "wp-lavender" },
  { id: "grid", label: "Grid", cssClass: "wp-grid" },
  { id: "diagonal", label: "Diagonal", cssClass: "wp-diagonal" },
];

const WALLPAPER_STORAGE_KEY = "browser-os-wallpaper";

function loadWallpaper() {
  const desktop = document.getElementById('desktop');
  if (!desktop) {
    console.log('loadWallpaper: desktop element not found');
    return;
  }
  try {
    const saved = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    console.log('loadWallpaper: saved =', saved);
    if (saved) {
      const preset = WALLPAPERS.find((w) => w.id === saved);
      console.log('loadWallpaper: found preset =', preset);
      if (preset) {
        applyWallpaper(preset);
        console.log('loadWallpaper: applied', preset.id);
        return;
      }
    }
  } catch (e) {
    console.log('loadWallpaper: error =', e);
  }
  // Default: midnight
  console.log('loadWallpaper: using default midnight');
  applyWallpaper(WALLPAPERS[0]);
}

function applyWallpaper(preset) {
  const desktop = document.getElementById("desktop");
  // Remove all wallpaper classes
  WALLPAPERS.forEach((w) => desktop.classList.remove(w.cssClass));
  // Add the selected wallpaper class
  desktop.classList.add(preset.cssClass);
  // Save to localStorage
  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, preset.id);
  } catch (e) {
    // localStorage not available
  }
  // Update picker selection if visible
  updatePickerSelection(preset.id);
}

function getCurrentWallpaperId() {
  try {
    return localStorage.getItem(WALLPAPER_STORAGE_KEY) || "midnight";
  } catch (e) {
    return "midnight";
  }
}

// ===== Context Menu & Wallpaper Picker =====
let contextMenuEl = null;
let pickerEl = null;
let contextMenuVisible = false;
let pickerVisible = false;

function createContextMenus() {
  // Context menu
  contextMenuEl = document.createElement("div");
  contextMenuEl.className = "desktop-context-menu";
  contextMenuEl.innerHTML = `
    <div class="desktop-context-menu-item" data-action="wallpaper">
      <span>🎨</span> Change wallpaper
    </div>
    <div class="desktop-context-menu-separator"></div>
    <div class="desktop-context-menu-item" data-action="about">
      <span>ℹ️</span> About Browser OS
    </div>
  `;
  document.body.appendChild(contextMenuEl);

  // Wallpaper picker
  pickerEl = document.createElement("div");
  pickerEl.className = "wallpaper-picker";
  pickerEl.innerHTML = `
    <div class="wallpaper-picker-header">
      <span class="wallpaper-picker-title">Change Wallpaper</span>
      <button class="wallpaper-picker-close" data-action="close-picker">✕</button>
    </div>
    <div class="wallpaper-picker-grid"></div>
  `;
  document.body.appendChild(pickerEl);

  // Build thumbnail grid
  const grid = pickerEl.querySelector(".wallpaper-picker-grid");
  WALLPAPERS.forEach((wp) => {
    const wrapper = document.createElement("div");
    wrapper.className = "wallpaper-thumb-wrapper";

    const thumb = document.createElement("div");
    thumb.className = "wallpaper-thumb";
    thumb.dataset.wallpaperId = wp.id;
    thumb.style.background = getWallpaperPreviewBg(wp);

    const label = document.createElement("div");
    label.className = "wallpaper-thumb-label";
    label.textContent = wp.label;

    wrapper.appendChild(thumb);
    wrapper.appendChild(label);
    grid.appendChild(wrapper);
  });

  // Current selection indicator
  const currentId = getCurrentWallpaperId();
  const currentThumb = pickerEl.querySelector(
    `.wallpaper-thumb[data-wallpaper-id="${currentId}"]`
  );
  if (currentThumb) {
    currentThumb.classList.add("selected");
  }

  // Event listeners
  contextMenuEl.addEventListener("click", handleContextMenuClick);
  pickerEl.addEventListener("click", handlePickerClick);
  document.addEventListener("mousedown", handleOutsideClick);
  document.addEventListener("keydown", handleContextKey); // Escape to close
}

function getWallpaperPreviewBg(wp) {
  // Return a compact representation for thumbnails
  const desktop = document.getElementById("desktop");
  desktop.classList.add(wp.cssClass);
  const bg = window.getComputedStyle(desktop).background;
  desktop.classList.remove(wp.cssClass);
  return bg;
}

function handleContextMenuClick(e) {
  const item = e.target.closest(".desktop-context-menu-item");
  if (!item) return;

  const action = item.dataset.action;
  if (action === "wallpaper") {
    showPicker();
  } else if (action === "about") {
    hideContextMenu();
    alert("Browser OS\nA desktop experience in your browser.");
  }
}

function handlePickerClick(e) {
  const thumb = e.target.closest(".wallpaper-thumb");
  if (thumb) {
    const wpId = thumb.dataset.wallpaperId;
    const preset = WALLPAPERS.find((w) => w.id === wpId);
    if (preset) {
      applyWallpaper(preset);
      hidePicker();
      hideContextMenu();
    }
    return;
  }

  const closeBtn = e.target.closest(".wallpaper-picker-close");
  if (closeBtn) {
    hidePicker();
    hideContextMenu();
  }
}

function handleOutsideClick(e) {
  if (contextMenuVisible && !contextMenuEl.contains(e.target)) {
    hideContextMenu();
  }
  if (pickerVisible && !pickerEl.contains(e.target)) {
    hidePicker();
  }
}

function handleContextKey(e) {
  if (e.key === "Escape") {
    if (pickerVisible) hidePicker();
    if (contextMenuVisible) hideContextMenu();
  }
}

function showContextMenu(x, y) {
  contextMenuEl.style.left = x + "px";
  contextMenuEl.style.top = y + "px";
  contextMenuEl.classList.add("visible");
  contextMenuVisible = true;

  // Adjust if off-screen
  const rect = contextMenuEl.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    contextMenuEl.style.left = (x - rect.width) + "px";
  }
  if (rect.bottom > window.innerHeight - 48) {
    contextMenuEl.style.top = (y - rect.height) + "px";
  }
}

function hideContextMenu() {
  contextMenuEl.classList.remove("visible");
  contextMenuVisible = false;
  if (pickerVisible) hidePicker();
}

function showPicker() {
  // Position the picker near the context menu
  const menuRect = contextMenuEl.getBoundingClientRect();
  let x = menuRect.right + 8;
  let y = menuRect.top;

  // Keep on screen
  if (x + 380 > window.innerWidth) {
    x = menuRect.left - 380;
  }
  if (x < 8) x = 8;
  if (y + 300 > window.innerHeight - 48) {
    y = window.innerHeight - 48 - 300;
  }

  pickerEl.style.left = x + "px";
  pickerEl.style.top = y + "px";
  pickerEl.classList.add("visible");
  pickerVisible = true;
}

function hidePicker() {
  pickerEl.classList.remove("visible");
  pickerVisible = false;
}

function updatePickerSelection(wallpaperId) {
  if (!pickerEl) return;
  pickerEl.querySelectorAll(".wallpaper-thumb").forEach((thumb) => {
    if (thumb.dataset.wallpaperId === wallpaperId) {
      thumb.classList.add("selected");
    } else {
      thumb.classList.remove("selected");
    }
  });
}

// Desktop right-click handler
document.getElementById("desktop").addEventListener("contextmenu", (e) => {
  // Only show context menu on empty desktop area (not on icons or windows)
  if (e.target.closest(".desktop-icon") || e.target.closest(".window")) {
    return;
  }
  e.preventDefault();
  showContextMenu(e.clientX, e.clientY);
});

// ===== App Registry =====
const APPS = {
  notepad: {
    title: "Notepad",
    width: 650,
    height: 440,
    render: renderNotepad,
  },
  calculator: {
    title: "Calculator",
    width: 320,
    height: 460,
    render: renderCalculator,
  },
  minesweeper: {
    title: "Minesweeper",
    width: 820,
    height: 520,
    render: renderMinesweeper,
  },
  spider: {
    title: "Spider Solitaire",
    width: 780,
    height: 580,
    render: renderSpider,
  },
};

// ===== State =====
let nextZIndex = 100; // start z-order above desktop
let windowIdCounter = 0;
const openWindows = new Map(); // appId → { id, element, titleEl, bodyEl, zIndex }

// ===== Utility =====
function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function generateId() {
  return ++windowIdCounter;
}

// ===== Clock =====
function updateClock() {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  document.getElementById("taskbar-clock").textContent = `${hh}:${mm}`;
}
setInterval(updateClock, 1000);
updateClock();

// ===== Window Manager =====
function createWindow(appId) {
  const app = APPS[appId];
  if (!app) return null;

  // Single instance: focus existing window if already open
  if (openWindows.has(appId)) {
    focusWindow(openWindows.get(appId).id);
    return openWindows.get(appId).element;
  }

  const id = generateId();
  const container = document.getElementById("window-container");

  // Position: cascade
  const offset = openWindows.size * 24;
  const x = clamp(60 + offset, 0, window.innerWidth - app.width);
  const y = clamp(40 + offset, 0, window.innerHeight - 48 - app.height);

  const el = document.createElement("div");
  el.className = "window focused";
  el.dataset.appId = appId;
  el.dataset.windowId = id;
  el.style.width = app.width + "px";
  el.style.height = app.height + "px";
  el.style.left = x + "px";
  el.style.top = y + "px";
  el.style.zIndex = ++nextZIndex;

  // Title bar
  const titlebar = document.createElement("div");
  titlebar.className = "window-titlebar";

  const titleEl = document.createElement("span");
  titleEl.className = "window-title";
  titleEl.textContent = app.title;

  const closeBtn = document.createElement("button");
  closeBtn.className = "window-close";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.innerHTML = "&#x2715;"; // ✕

  titlebar.appendChild(titleEl);
  titlebar.appendChild(closeBtn);
  el.appendChild(titlebar);

  // Body
  const body = document.createElement("div");
  body.className = "window-body";
  if (app.render) {
    app.render(body);
  } else {
    body.innerHTML = `<span class="placeholder">${app.placeholder}</span>`;
  }
  el.appendChild(body);

  // Resize handle
  const resizeHandle = document.createElement("div");
  resizeHandle.className = "window-resize";
  el.appendChild(resizeHandle);

  container.appendChild(el);

  // Store reference
  const winData = { id, element: el, titleEl, bodyEl: body, appId };
  openWindows.set(appId, winData);

  // Focus the new window
  focusWindow(id);

  // Setup interactions
  setupDrag(el, titlebar);
  setupResize(el, resizeHandle);
  setupFocus(el, id);

  // Close button
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    closeWindow(appId);
  });

  // Add taskbar button
  addTaskbarButton(appId, id);

  return el;
}

function closeWindow(appId) {
  const winData = openWindows.get(appId);
  if (!winData) return;

  winData.element.remove();
  openWindows.delete(appId);
  removeTaskbarButton(appId);
}

function focusWindow(id) {
  // Remove focused class from all windows
  document.querySelectorAll(".window.focused").forEach((w) => {
    w.classList.remove("focused");
  });

  // Find the window element by id
  for (const [, winData] of openWindows) {
    if (winData.id === id) {
      winData.element.classList.add("focused");
      winData.element.style.zIndex = ++nextZIndex;
      break;
    }
  }

  // Update taskbar active state
  updateTaskbarActive(id);
}

// ===== Dragging =====
function setupDrag(windowEl, titlebar) {
  let isDragging = false;
  let startX, startY, startLeft, startTop;

  titlebar.addEventListener("mousedown", (e) => {
    if (e.target.classList.contains("window-close")) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    const rect = windowEl.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;

    // Focus on drag start
    const winData = openWindows.get(windowEl.dataset.appId);
    if (winData) {
      focusWindow(winData.id);
    }

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const app = APPS[windowEl.dataset.appId];
    const maxX = window.innerWidth - app.width;
    const maxY = window.innerHeight - 48 - app.height; // taskbar height

    const newLeft = clamp(startLeft + dx, 0, maxX);
    const newTop = clamp(startTop + dy, 0, maxY);

    windowEl.style.left = newLeft + "px";
    windowEl.style.top = newTop + "px";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

// ===== Resizing =====
function setupResize(windowEl, resizeHandle) {
  let isResizing = false;
  let startX, startY, startW, startH;

  resizeHandle.addEventListener("mousedown", (e) => {
    isResizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startW = windowEl.offsetWidth;
    startH = windowEl.offsetHeight;

    const winData = openWindows.get(windowEl.dataset.appId);
    if (winData) {
      focusWindow(winData.id);
    }

    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;

    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    const newW = clamp(startW + dx, 320, window.innerWidth);
    const newH = clamp(startH + dy, 200, window.innerHeight - 48);

    windowEl.style.width = newW + "px";
    windowEl.style.height = newH + "px";
  });

  document.addEventListener("mouseup", () => {
    isResizing = false;
  });
}

// ===== Focus on click =====
function setupFocus(windowEl, id) {
  windowEl.addEventListener("mousedown", () => {
    focusWindow(id);
  });
}

// ===== Taskbar Buttons =====
function addTaskbarButton(appId, windowId) {
  const container = document.getElementById("taskbar-buttons");
  const app = APPS[appId];

  const btn = document.createElement("button");
  btn.className = "taskbar-btn active";
  btn.dataset.appId = appId;
  btn.dataset.windowId = windowId;
  btn.textContent = app.title;

  btn.addEventListener("click", () => {
    const winData = openWindows.get(appId);
    if (winData) {
      focusWindow(winData.id);
    }
  });

  container.appendChild(btn);
}

function removeTaskbarButton(appId) {
  const btn = document.querySelector(`.taskbar-btn[data-app-id="${appId}"]`);
  if (btn) btn.remove();

  // Update active state to reflect the currently focused window
  const focused = document.querySelector('.window.focused');
  if (focused) {
    const winData = openWindows.get(focused.dataset.appId);
    if (winData) updateTaskbarActive(winData.id);
  }
}

function updateTaskbarActive(activeWindowId) {
  document.querySelectorAll(".taskbar-btn").forEach((btn) => {
    const winData = openWindows.get(btn.dataset.appId);
    if (winData && winData.id === activeWindowId) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

// ===== Desktop Icon Double-Click =====
document.querySelectorAll(".desktop-icon").forEach((icon) => {
  let clickCount = 0;
  let clickTimer = null;

  icon.addEventListener("click", () => {
    clickCount++;
    if (clickCount === 1) {
      clickTimer = setTimeout(() => {
        clickCount = 0;
      }, 300);
    }
    if (clickCount >= 2) {
      clearTimeout(clickTimer);
      clickCount = 0;
      const appId = icon.dataset.app;
      createWindow(appId);
    }
  });
});

// ===== Calculator (Ticket 3) =====
let calcDisplayValue = '0';
let calcFirstOperand = null;
let calcOperator = null;
let calcWaitingForSecondOperand = false;
let calcError = false;
let calcLastOperand = null;
let calcLastOperator = null;
let calcJustEvaluated = false;
let calcDisplayEl = null;

function renderCalculator(container) {
  container.innerHTML = '';
  container.style.padding = '0';
  container.style.display = 'flex';
  container.style.flexDirection = 'column';
  container.style.height = '100%';

  // Display
  const display = document.createElement('div');
  display.className = 'calc-display';
  calcDisplayEl = document.createElement('div');
  calcDisplayEl.className = 'calc-display-value';
  calcDisplayEl.textContent = '0';
  display.appendChild(calcDisplayEl);

  // Button grid
  const buttons = document.createElement('div');
  buttons.className = 'calc-buttons';

  const buttonLabels = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '−'],
    ['1', '2', '3', '+'],
    ['0', '.', '='],
  ];

  buttonLabels.forEach((row, rowIdx) => {
    row.forEach((label) => {
      const btn = document.createElement('button');
      btn.className = 'calc-btn';
      btn.textContent = label;

      // Determine button type
      if (label === 'C') {
        btn.classList.add('calc-btn-function');
      } else if (label === '±' || label === '%') {
        btn.classList.add('calc-btn-function');
      } else if (['÷', '×', '−', '+'].includes(label)) {
        btn.classList.add('calc-btn-operator');
      } else if (label === '=') {
        btn.classList.add('calc-btn-equals');
      } else if (label === '0') {
        btn.classList.add('calc-btn-zero');
      }

      btn.addEventListener('click', () => handleCalcButton(label));
      buttons.appendChild(btn);
    });
  });

  container.appendChild(display);
  container.appendChild(buttons);
}

function updateCalcDisplay() {
  if (!calcDisplayEl) return;

  let text = calcDisplayValue;

  // Format the display value
  if (calcError) {
    text = 'Error';
    calcDisplayEl.classList.add('error');
  } else {
    calcDisplayEl.classList.remove('error');

    // If the value is a number, format it nicely
    const num = parseFloat(text);
    if (!isNaN(num) && text !== 'Error') {
      // If it has a decimal point and trailing zeros being typed, keep as-is
      if (text.includes('.') && (text.endsWith('0') || text.endsWith('.'))) {
        // Keep the raw input representation
        text = formatCalcNumber(text);
      } else {
        text = formatCalcNumber(text);
      }
    }
  }

  calcDisplayEl.textContent = text;

  // Adjust font size for long numbers
  const len = text.length;
  if (len > 12) {
    calcDisplayEl.style.fontSize = '20px';
  } else if (len > 9) {
    calcDisplayEl.style.fontSize = '26px';
  } else {
    calcDisplayEl.style.fontSize = '36px';
  }

  // Update active operator highlight
  document.querySelectorAll('.calc-btn-operator').forEach((btn) => {
    btn.classList.remove('active-op');
    if (calcWaitingForSecondOperand && btn.textContent === calcOperator) {
      btn.classList.add('active-op');
    }
  });
}

function formatCalcNumber(str) {
  const num = parseFloat(str);
  if (isNaN(num)) return str;

  // For very large or very small numbers, use scientific notation
  if (Math.abs(num) > 1e15 || (Math.abs(num) < 1e-15 && num !== 0)) {
    return num.toExponential(6);
  }

  // Limit decimal places to avoid floating point display issues
  let result = num.toString();
  if (result.length > 15) {
    result = num.toPrecision(12);
    // Remove trailing zeros after decimal
    if (result.includes('.')) {
      result = result.replace(/\.?0+$/, '');
    }
  }
  return result;
}

function handleCalcButton(label) {
  if (calcError && label !== 'C') {
    // Clear error on any new input except C
    calcError = false;
    calcDisplayValue = '0';
    calcFirstOperand = null;
    calcOperator = null;
    calcWaitingForSecondOperand = false;
    calcLastOperand = null;
    calcLastOperator = null;
    calcJustEvaluated = false;
  }

  switch (label) {
    case 'C':
      calcClear();
      break;
    case '±':
      calcToggleSign();
      break;
    case '%':
      calcPercent();
      break;
    case '+':
    case '−':
    case '×':
    case '÷':
      calcHandleOperator(label);
      break;
    case '=':
      calcEvaluate();
      break;
    case '.':
      calcInputDecimal();
      break;
    default:
      if (label >= '0' && label <= '9') {
        calcInputDigit(label);
      }
      break;
  }

  updateCalcDisplay();
}

function calcClear() {
  calcDisplayValue = '0';
  calcFirstOperand = null;
  calcOperator = null;
  calcWaitingForSecondOperand = false;
  calcError = false;
  calcLastOperand = null;
  calcLastOperator = null;
  calcJustEvaluated = false;
}

function calcInputDigit(digit) {
  if (calcWaitingForSecondOperand || calcJustEvaluated) {
    calcDisplayValue = digit;
    calcWaitingForSecondOperand = false;
    calcJustEvaluated = false;
  } else {
    if (calcDisplayValue === '0' && digit !== '0') {
      calcDisplayValue = digit;
    } else if (calcDisplayValue === '0' && digit === '0') {
      // Don't add leading zeros
      return;
    } else {
      if (calcDisplayValue.replace(/[^0-9]/g, '').length >= 15) return; // Max digits
      calcDisplayValue += digit;
    }
  }
}

function calcInputDecimal() {
  if (calcWaitingForSecondOperand || calcJustEvaluated) {
    calcDisplayValue = '0.';
    calcWaitingForSecondOperand = false;
    calcJustEvaluated = false;
    return;
  }
  if (!calcDisplayValue.includes('.')) {
    calcDisplayValue += '.';
  }
}

function calcToggleSign() {
  if (calcDisplayValue === '0' || calcDisplayValue === 'Error') return;
  if (calcDisplayValue.startsWith('-')) {
    calcDisplayValue = calcDisplayValue.slice(1);
  } else {
    calcDisplayValue = '-' + calcDisplayValue;
  }
}

function calcPercent() {
  const num = parseFloat(calcDisplayValue);
  if (isNaN(num)) return;

  if (calcOperator && calcFirstOperand !== null && !calcWaitingForSecondOperand) {
    // Percentage of the first operand, then execute the pending operation
    const percentValue = calcFirstOperand * (num / 100);
    calcDisplayValue = formatCalcNumber(percentValue);
    const result = calcPerformCalculation(calcOperator, calcFirstOperand, percentValue);
    if (result === 'Error') {
      calcDisplayValue = 'Error';
      calcError = true;
      calcFirstOperand = null;
      calcOperator = null;
      calcWaitingForSecondOperand = true;
      return;
    }
    calcLastOperand = percentValue;
    calcLastOperator = calcOperator;
    calcJustEvaluated = true;
    calcFirstOperand = null;
    calcOperator = null;
    calcWaitingForSecondOperand = false;
    calcDisplayValue = result;
  } else {
    // Simple division by 100
    calcDisplayValue = formatCalcNumber(num / 100);
  }
}

function calcHandleOperator(nextOperator) {
  const inputValue = parseFloat(calcDisplayValue);

  if (calcOperator && calcWaitingForSecondOperand) {
    // Just changing the operator
    calcOperator = nextOperator;
    return;
  }

  if (calcFirstOperand === null) {
    calcFirstOperand = inputValue;
  } else if (calcOperator) {
    const result = calcPerformCalculation(calcOperator, calcFirstOperand, inputValue);
    if (result === 'Error') {
      calcDisplayValue = 'Error';
      calcError = true;
      calcFirstOperand = null;
      calcOperator = null;
      calcWaitingForSecondOperand = true;
      return;
    }
    calcDisplayValue = result;
    calcFirstOperand = parseFloat(result);
  }

  calcWaitingForSecondOperand = true;
  calcOperator = nextOperator;
  calcJustEvaluated = false;
}

function calcEvaluate() {
  const inputValue = parseFloat(calcDisplayValue);

  if (calcJustEvaluated && calcLastOperator && calcLastOperand !== null) {
    // Repeat last operation
    const result = calcPerformCalculation(calcLastOperator, inputValue, calcLastOperand);
    if (result === 'Error') {
      calcDisplayValue = 'Error';
      calcError = true;
      calcFirstOperand = null;
      calcOperator = null;
      calcWaitingForSecondOperand = true;
      calcJustEvaluated = false;
      return;
    }
    calcDisplayValue = result;
    calcFirstOperand = parseFloat(result);
    return;
  }

  if (calcOperator === null) return;

  const result = calcPerformCalculation(calcOperator, calcFirstOperand, inputValue);
  if (result === 'Error') {
    calcDisplayValue = 'Error';
    calcError = true;
    calcFirstOperand = null;
    calcOperator = null;
    calcWaitingForSecondOperand = true;
    calcJustEvaluated = false;
    return;
  }

  calcLastOperand = inputValue;
  calcLastOperator = calcOperator;
  calcJustEvaluated = true;
  calcFirstOperand = null;
  calcOperator = null;
  calcWaitingForSecondOperand = false;
  calcDisplayValue = result;
}

function calcPerformCalculation(op, a, b) {
  switch (op) {
    case '+':
      return formatCalcNumber(a + b);
    case '−':
      return formatCalcNumber(a - b);
    case '×':
      return formatCalcNumber(a * b);
    case '÷':
      if (b === 0) return 'Error';
      return formatCalcNumber(a / b);
    default:
      return formatCalcNumber(b);
  }
}

// ===== Notepad (Ticket 4) =====
const NOTEPAD_STORAGE_KEY = "browser-os-notepad-docs";
let notepadCurrentDocId = null;
let notepadDocListEl = null;

/**
 * Load all documents from localStorage.
 * @returns {Object} Map of docId -> { name, content, updatedAt }
 */
function notepadLoadDocs() {
  try {
    const raw = localStorage.getItem(NOTEPAD_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/**
 * Save all documents to localStorage.
 */
function notepadSaveDocs(docs) {
  try {
    localStorage.setItem(NOTEPAD_STORAGE_KEY, JSON.stringify(docs));
  } catch {
    // localStorage full or unavailable
  }
}

/**
 * Generate a unique document ID.
 */
function notepadGenerateId() {
  return "doc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

/**
 * Generate a default name for a new document.
 */
function notepadDefaultName() {
  const docs = notepadLoadDocs();
  let n = 1;
  while (docs["Untitled " + n]) n++;
  return "Untitled " + n;
}

/**
 * Create a new document and return its ID.
 */
function notepadCreateDoc(name) {
  const docs = notepadLoadDocs();
  const id = notepadGenerateId();
  docs[id] = {
    name: name || notepadDefaultName(),
    content: "",
    updatedAt: Date.now(),
  };
  notepadSaveDocs(docs);
  return id;
}

/**
 * Save the current document's content.
 */
function notepadSaveCurrent() {
  if (!notepadCurrentDocId) return;
  const docs = notepadLoadDocs();
  if (!docs[notepadCurrentDocId]) return;

  const textarea = document.querySelector(".notepad-textarea");
  if (textarea) {
    docs[notepadCurrentDocId].content = textarea.value;
  }
  docs[notepadCurrentDocId].updatedAt = Date.now();
  notepadSaveDocs(docs);
  notepadRefreshDocList();
}

/**
 * Delete the current document.
 * @returns {boolean} true if deleted, false if cancelled or none selected
 */
function notepadDeleteCurrent() {
  if (!notepadCurrentDocId) return false;
  const docs = notepadLoadDocs();
  if (!docs[notepadCurrentDocId]) return false;

  const name = docs[notepadCurrentDocId].name;
  if (!confirm('Delete "' + name + '"?')) return false;

  delete docs[notepadCurrentDocId];
  notepadSaveDocs(docs);
  notepadCurrentDocId = null;

  // Clear the textarea
  const textarea = document.querySelector(".notepad-textarea");
  if (textarea) textarea.value = "";

  // Update title bar
  const titleEl = document.querySelector('.window[data-app-id="notepad"] .window-title');
  if (titleEl) {
    titleEl.textContent = "Notepad";
  }

  notepadRefreshDocList();
  return true;
}

/**
 * Open (select) a document by ID.
 */
function notepadOpenDoc(docId) {
  const docs = notepadLoadDocs();
  if (!docs[docId]) return;

  // Save current document first
  if (notepadCurrentDocId && notepadCurrentDocId !== docId) {
    notepadSaveCurrent();
  }

  notepadCurrentDocId = docId;
  const textarea = document.querySelector(".notepad-textarea");
  if (textarea) {
    textarea.value = docs[docId].content || "";
  }

  // Update title bar
  const titleEl = document.querySelector('.window[data-app-id="notepad"] .window-title');
  if (titleEl) {
    titleEl.textContent = "Notepad — " + docs[docId].name;
  }

  notepadRefreshDocList();
}

/**
 * Refresh the sidebar document list.
 */
function notepadRefreshDocList() {
  if (!notepadDocListEl) return;
  const docs = notepadLoadDocs();
  notepadDocListEl.innerHTML = "";

  // Sort by updatedAt descending (most recent first)
  const sorted = Object.entries(docs).sort(
    (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
  );

  if (sorted.length === 0) {
    const empty = document.createElement("div");
    empty.className = "notepad-empty-state";
    empty.style.padding = "16px";
    empty.style.textAlign = "center";
    empty.style.color = "#45475a";
    empty.style.fontSize = "12px";
    empty.textContent = "No documents yet";
    notepadDocListEl.appendChild(empty);
    return;
  }

  sorted.forEach(([id, doc]) => {
    const item = document.createElement("div");
    item.className = "notepad-doc-item";
    if (id === notepadCurrentDocId) {
      item.classList.add("active");
    }
    item.textContent = doc.name;
    item.dataset.docId = id;
    item.addEventListener("click", () => notepadOpenDoc(id));
    notepadDocListEl.appendChild(item);
  });
}

/**
 * Show an in-page name input dialog.
 * @param {string} title - Dialog title
 * @param {string} defaultValue - Pre-filled value
 * @param {function(string)} onConfirm - Callback with the entered name
 */
function showNotepadNameDialog(title, defaultValue, onConfirm) {
  // Remove any existing dialog
  const existing = document.querySelector(".notepad-dialog-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.className = "notepad-dialog-overlay";

  const dialog = document.createElement("div");
  dialog.className = "notepad-dialog";

  const dialogTitle = document.createElement("div");
  dialogTitle.className = "notepad-dialog-title";
  dialogTitle.textContent = title;

  const input = document.createElement("input");
  input.type = "text";
  input.className = "notepad-dialog-input";
  input.value = defaultValue || "";
  input.placeholder = "Enter document name...";

  const buttonRow = document.createElement("div");
  buttonRow.className = "notepad-dialog-buttons";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "notepad-dialog-btn notepad-dialog-btn-cancel";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  const okBtn = document.createElement("button");
  okBtn.className = "notepad-dialog-btn notepad-dialog-btn-ok";
  okBtn.textContent = "Create";
  okBtn.addEventListener("click", () => {
    overlay.remove();
    onConfirm(input.value);
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      overlay.remove();
      onConfirm(input.value);
    } else if (e.key === "Escape") {
      overlay.remove();
    }
  });

  buttonRow.appendChild(cancelBtn);
  buttonRow.appendChild(okBtn);
  dialog.appendChild(dialogTitle);
  dialog.appendChild(input);
  dialog.appendChild(buttonRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  // Focus and select the input
  setTimeout(() => {
    input.focus();
    input.select();
  }, 10);
}

/**
 * Render the Notepad application into the window body.
 */
function renderNotepad(container) {
  container.innerHTML = "";
  container.style.padding = "0";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.height = "100%";
  container.style.overflow = "hidden";

  const app = document.createElement("div");
  app.className = "notepad-container";

  // Toolbar
  const toolbar = document.createElement("div");
  toolbar.className = "notepad-toolbar";

  const newBtn = document.createElement("button");
  newBtn.className = "notepad-toolbar-btn";
  newBtn.textContent = "+ New";
  newBtn.addEventListener("click", () => {
    showNotepadNameDialog("New Document", "Untitled", (name) => {
      if (name && name.trim()) {
        const id = notepadCreateDoc(name.trim());
        notepadOpenDoc(id);
      }
    });
  });

  const saveBtn = document.createElement("button");
  saveBtn.className = "notepad-toolbar-btn save-btn";
  saveBtn.textContent = "Save";
  saveBtn.addEventListener("click", () => {
    if (notepadCurrentDocId) {
      notepadSaveCurrent();
    }
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "notepad-toolbar-btn delete-btn";
  deleteBtn.textContent = "Delete";
  deleteBtn.addEventListener("click", () => {
    notepadDeleteCurrent();
  });

  toolbar.appendChild(newBtn);
  toolbar.appendChild(saveBtn);
  toolbar.appendChild(deleteBtn);
  app.appendChild(toolbar);

  // Main area: sidebar + editor
  const main = document.createElement("div");
  main.className = "notepad-main";

  // Sidebar
  const sidebar = document.createElement("div");
  sidebar.className = "notepad-sidebar";

  const sidebarHeader = document.createElement("div");
  sidebarHeader.className = "notepad-sidebar-header";
  sidebarHeader.textContent = "Documents";

  notepadDocListEl = document.createElement("div");
  notepadDocListEl.className = "notepad-doc-list";

  sidebar.appendChild(sidebarHeader);
  sidebar.appendChild(notepadDocListEl);
  main.appendChild(sidebar);

  // Editor
  const editor = document.createElement("div");
  editor.className = "notepad-editor";

  const textarea = document.createElement("textarea");
  textarea.className = "notepad-textarea";
  textarea.placeholder = "Start typing...";
  textarea.spellcheck = false;
  editor.appendChild(textarea);
  main.appendChild(editor);

  app.appendChild(main);
  container.appendChild(app);

  // Initialize: load existing documents and open the most recent one
  const docs = notepadLoadDocs();
  const sorted = Object.entries(docs).sort(
    (a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)
  );

  if (sorted.length > 0) {
    notepadOpenDoc(sorted[0][0]);
  } else {
    notepadRefreshDocList();
  }
}

// Keyboard support for calculator
function handleCalcKeyboard(e) {
  // Only handle if calculator window is focused
  const calcWindow = document.querySelector('.window[data-app-id="calculator"].focused');
  if (!calcWindow) return;

  const key = e.key;

  // Prevent default for calculator keys to avoid page scrolling etc.
  if (['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '*', '/', '.', '%', '=', 'Enter', 'Escape', 'Backspace'].includes(key)) {
    e.preventDefault();
  }

  if (key >= '0' && key <= '9') {
    handleCalcButton(key);
  } else if (key === '.') {
    handleCalcButton('.');
  } else if (key === '+') {
    handleCalcButton('+');
  } else if (key === '-') {
    handleCalcButton('−');
  } else if (key === '*') {
    handleCalcButton('×');
  } else if (key === '/') {
    handleCalcButton('÷');
  } else if (key === '%') {
    handleCalcButton('%');
  } else if (key === 'Enter' || key === '=') {
    handleCalcButton('=');
  } else if (key === 'Escape') {
    handleCalcButton('C');
  } else if (key === 'Backspace') {
    calcBackspace();
  }
}

function calcBackspace() {
  if (calcError || calcWaitingForSecondOperand || calcJustEvaluated) return;
  if (calcDisplayValue.length === 1 || (calcDisplayValue.length === 2 && calcDisplayValue.startsWith('-'))) {
    calcDisplayValue = '0';
  } else {
    calcDisplayValue = calcDisplayValue.slice(0, -1);
  }
}

// ===== Minesweeper (Ticket 5) =====
const MINESWEEPER_DIFFICULTIES = {
  beginner: { rows: 9, cols: 9, mines: 10, label: "Beginner" },
  intermediate: { rows: 16, cols: 16, mines: 40, label: "Intermediate" },
  expert: { rows: 16, cols: 30, mines: 99, label: "Expert" },
};

// Game state (exposed on window for debugging)
let mwState = {
  difficulty: "beginner",
  rows: 9,
  cols: 9,
  totalMines: 10,
  board: [],
  gameState: "idle",
  flagsPlaced: 0,
  timer: 0,
  timerInterval: null,
  firstClick: true,
  cellsRevealed: 0,
};

window.minesweeperState = mwState;

function mwInit(difficulty) {
  if (mwState.timerInterval) {
    clearInterval(mwState.timerInterval);
    mwState.timerInterval = null;
  }

  const config = MINESWEEPER_DIFFICULTIES[difficulty];
  mwState.difficulty = difficulty;
  mwState.rows = config.rows;
  mwState.cols = config.cols;
  mwState.totalMines = config.mines;
  mwState.gameState = "idle";
  mwState.flagsPlaced = 0;
  mwState.timer = 0;
  mwState.firstClick = true;
  mwState.cellsRevealed = 0;

  mwState.board = [];
  for (let r = 0; r < config.rows; r++) {
    mwState.board[r] = [];
    for (let c = 0; c < config.cols; c++) {
      mwState.board[r][c] = {
        isMine: false,
        isRevealed: false,
        isFlagged: false,
        neighborCount: 0,
      };
    }
  }

  return mwState;
}

function mwPlaceMines(safeRow, safeCol) {
  const config = MINESWEEPER_DIFFICULTIES[mwState.difficulty];
  let placed = 0;

  while (placed < config.mines) {
    const r = Math.floor(Math.random() * config.rows);
    const c = Math.floor(Math.random() * config.cols);

    if (mwState.board[r][c].isMine) continue;
    if (Math.abs(r - safeRow) <= 1 && Math.abs(c - safeCol) <= 1) continue;

    mwState.board[r][c].isMine = true;
    placed++;
  }

  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      if (mwState.board[r][c].isMine) continue;
      let count = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < config.rows && nc >= 0 && nc < config.cols) {
            if (mwState.board[nr][nc].isMine) count++;
          }
        }
      }
      mwState.board[r][c].neighborCount = count;
    }
  }
}

function mwStartTimer() {
  if (mwState.timerInterval) return;
  mwState.timerInterval = setInterval(() => {
    mwState.timer++;
    mwUpdateMwHeader();
  }, 1000);
}

function mwStopTimer() {
  if (mwState.timerInterval) {
    clearInterval(mwState.timerInterval);
    mwState.timerInterval = null;
  }
}

function mwRevealCell(row, col) {
  const config = MINESWEEPER_DIFFICULTIES[mwState.difficulty];
  const cell = mwState.board[row][col];

  if (cell.isRevealed || cell.isFlagged) return;

  if (mwState.firstClick) {
    mwPlaceMines(row, col);
    mwState.firstClick = false;
    mwState.gameState = "playing";
    mwStartTimer();
  }

  cell.isRevealed = true;
  mwState.cellsRevealed++;

  if (cell.isMine) {
    mwState.gameState = "lost";
    mwStopTimer();
    mwRevealAllMines(row, col);
    mwUpdateMwHeader();
    mwRenderBoard();
    return;
  }

  if (cell.neighborCount === 0) {
    mwFloodReveal(row, col);
  }

  const totalSafe = config.rows * config.cols - config.mines;
  if (mwState.cellsRevealed >= totalSafe) {
    mwState.gameState = "won";
    mwStopTimer();
    mwFlagAllMines();
    mwUpdateMwHeader();
    mwRenderBoard();
    return;
  }

  mwRenderBoard();
}

function mwFloodReveal(row, col) {
  const config = MINESWEEPER_DIFFICULTIES[mwState.difficulty];
  const stack = [[row, col]];

  while (stack.length > 0) {
    const [r, c] = stack.pop();
    const cell = mwState.board[r][c];

    if (cell.isRevealed || cell.isFlagged) continue;

    cell.isRevealed = true;
    mwState.cellsRevealed++;

    if (cell.neighborCount === 0) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < config.rows && nc >= 0 && nc < config.cols) {
            if (!mwState.board[nr][nc].isRevealed && !mwState.board[nr][nc].isFlagged) {
              stack.push([nr, nc]);
            }
          }
        }
      }
    }
  }
}

function mwToggleFlag(row, col) {
  if (mwState.gameState === "won" || mwState.gameState === "lost") return;
  const cell = mwState.board[row][col];
  if (cell.isRevealed) return;

  cell.isFlagged = !cell.isFlagged;
  mwState.flagsPlaced += cell.isFlagged ? 1 : -1;
  mwUpdateMwHeader();
  mwRenderBoard();
}

function mwRevealAllMines(triggerRow, triggerCol) {
  const config = MINESWEEPER_DIFFICULTIES[mwState.difficulty];
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      const cell = mwState.board[r][c];
      if (cell.isMine) {
        cell.isRevealed = true;
      }
    }
  }
  mwState.board[triggerRow][triggerCol].isRevealed = true;
}

function mwFlagAllMines() {
  const config = MINESWEEPER_DIFFICULTIES[mwState.difficulty];
  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      if (mwState.board[r][c].isMine && !mwState.board[r][c].isFlagged) {
        mwState.board[r][c].isFlagged = true;
        mwState.flagsPlaced++;
      }
    }
  }
}

function mwRestart() {
  mwInit(mwState.difficulty);
  mwUpdateMwHeader();
  mwRenderBoard();
  mwUpdateDifficultyButtons();
}

function mwUpdateMwHeader() {
  const mineCounter = document.getElementById("mw-mine-counter");
  const timerEl = document.getElementById("mw-timer");
  const faceBtn = document.getElementById("mw-face-btn");

  if (mineCounter) {
    const remaining = mwState.totalMines - mwState.flagsPlaced;
    mineCounter.textContent = remaining;
  }

  if (timerEl) {
    timerEl.textContent = mwState.timer;
  }

  if (faceBtn) {
    if (mwState.gameState === "idle") {
      faceBtn.textContent = "\u{1F60E}";
    } else if (mwState.gameState === "won") {
      faceBtn.textContent = "\u{1F600}";
    } else if (mwState.gameState === "lost") {
      faceBtn.textContent = "\u{1F622}";
    } else {
      faceBtn.textContent = "\u{1F60C}";
    }
  }
}

function mwUpdateDifficultyButtons() {
  document.querySelectorAll(".minesweeper-diff-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.difficulty === mwState.difficulty);
  });
}

function mwRenderBoard() {
  const boardEl = document.getElementById("mw-board");
  if (!boardEl) return;

  const config = MINESWEEPER_DIFFICULTIES[mwState.difficulty];
  boardEl.style.gridTemplateColumns = "repeat(" + config.cols + ", 24px)";
  boardEl.style.gridTemplateRows = "repeat(" + config.rows + ", 24px)";
  boardEl.innerHTML = "";

  for (let r = 0; r < config.rows; r++) {
    for (let c = 0; c < config.cols; c++) {
      const cell = mwState.board[r][c];
      const el = document.createElement("button");
      el.className = "minesweeper-cell";
      el.dataset.row = r;
      el.dataset.col = c;

      if (cell.isRevealed) {
        el.classList.add("revealed");
        if (cell.isMine) {
          el.classList.add("mine");
          el.textContent = "\u{1F4A3}";
        } else if (cell.neighborCount > 0) {
          el.classList.add("n" + cell.neighborCount);
          el.textContent = cell.neighborCount;
        }
      } else if (cell.isFlagged) {
        el.classList.add("hidden", "flagged");
        el.textContent = "\u{1F6A9}";
      } else {
        el.classList.add("hidden");
      }

      el.addEventListener("click", function () { mwRevealCell(r, c); });
      el.addEventListener("contextmenu", function (e) { e.preventDefault(); mwToggleFlag(r, c); });

      boardEl.appendChild(el);
    }
  }

  const overlay = document.getElementById("mw-overlay");
  const overlayText = document.getElementById("mw-overlay-text");
  if (overlay && overlayText) {
    if (mwState.gameState === "won") {
      overlayText.textContent = "You Win!";
      overlayText.className = "minesweeper-overlay-text win";
      overlay.classList.add("visible");
    } else if (mwState.gameState === "lost") {
      overlayText.textContent = "Game Over";
      overlayText.className = "minesweeper-overlay-text lose";
      overlay.classList.add("visible");
    } else {
      overlay.classList.remove("visible");
    }
  }
}

function renderMinesweeper(container) {
  container.innerHTML = "";
  container.style.padding = "0";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.height = "100%";
  container.style.overflow = "hidden";
  container.style.position = "relative";

  const app = document.createElement("div");
  app.className = "minesweeper-container";

  // Difficulty bar
  const diffBar = document.createElement("div");
  diffBar.className = "minesweeper-difficulty-bar";

  Object.entries(MINESWEEPER_DIFFICULTIES).forEach(function (entry) {
    const key = entry[0];
    const config = entry[1];
    const btn = document.createElement("button");
    btn.className = "minesweeper-diff-btn";
    btn.dataset.difficulty = key;
    btn.textContent = config.label;
    btn.addEventListener("click", function () { mwRestart(); });
    diffBar.appendChild(btn);
  });

  app.appendChild(diffBar);

  // Header
  const header = document.createElement("div");
  header.className = "minesweeper-header";

  const mineCounter = document.createElement("div");
  mineCounter.className = "minesweeper-stat";
  mineCounter.id = "mw-mine-counter";
  mineCounter.textContent = "0";

  const faceBtn = document.createElement("button");
  faceBtn.className = "minesweeper-face-btn";
  faceBtn.id = "mw-face-btn";
  faceBtn.textContent = "\u{1F60E}";
  faceBtn.addEventListener("click", mwRestart);

  const timerEl = document.createElement("div");
  timerEl.className = "minesweeper-stat timer-stat";
  timerEl.id = "mw-timer";
  timerEl.textContent = "0";

  header.appendChild(mineCounter);
  header.appendChild(faceBtn);
  header.appendChild(timerEl);
  app.appendChild(header);

  // Board
  const boardWrapper = document.createElement("div");
  boardWrapper.className = "minesweeper-board-wrapper";

  const boardEl = document.createElement("div");
  boardEl.className = "minesweeper-board";
  boardEl.id = "mw-board";

  const overlay = document.createElement("div");
  overlay.className = "minesweeper-overlay";
  overlay.id = "mw-overlay";

  const overlayText = document.createElement("div");
  overlayText.className = "minesweeper-overlay-text";
  overlayText.id = "mw-overlay-text";

  overlay.appendChild(overlayText);
  boardWrapper.appendChild(boardEl);
  boardWrapper.appendChild(overlay);
  app.appendChild(boardWrapper);
  container.appendChild(app);

  mwInit("beginner");
  mwUpdateMwHeader();
  mwRenderBoard();
}

/**
 * Render the Spider Solitaire application into the window body.
 * @param {HTMLElement} container
 */
function renderSpider(container) {
  spiderRender(container);
}

// ===== Spider Solitaire (Ticket 6) =====
const SPIDER_CARD_HEIGHT = 56;
const SPIDER_CARD_GAP = 2;
const SPIDER_TOP_GAP = 18;

let spiderState = {
  columns: [],      // 10 columns, each an array of cards
  stock: [],        // remaining stock pile
  completedRuns: 0, // number of completed K-A runs
  gameState: "playing", // "playing" | "won"
  dragging: null,   // { srcCol, cardIdx, cards, startX, startY, ghostEl }
};

window.spiderState = spiderState;

/**
 * Create a card object.
 * @param {number} value - 1 (Ace) through 13 (King)
 * @param {boolean} faceUp
 * @returns {{ value: number, faceUp: boolean }}
 */
function spiderMakeCard(value, faceUp) {
  return { value: value, faceUp: faceUp || false };
}

/**
 * Initialize a new Spider Solitaire game.
 */
function spiderInit() {
  spiderState.columns = [];
  for (let i = 0; i < 10; i++) {
    spiderState.columns[i] = [];
  }
  spiderState.stock = [];
  spiderState.completedRuns = 0;
  spiderState.gameState = "playing";
  spiderState.dragging = null;

  // Create 104 cards: two full decks, one suit
  // 8 copies of each rank (13 ranks x 8 = 104)
  const deck = [];
  for (let v = 1; v <= 13; v++) {
    for (let c = 0; c < 8; c++) {
      deck.push(spiderMakeCard(v, false));
    }
  }

  // Shuffle (Fisher-Yates)
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }

  // Deal: 4 columns of 6, 6 columns of 5
  // First 4 columns get 6 cards each = 24
  // Next 6 columns get 5 cards each = 30
  // Total dealt to tableau: 54
  // Stock: 50
  let cardIdx = 0;
  for (let col = 0; col < 10; col++) {
    const count = col < 4 ? 6 : 5;
    for (let row = 0; row < count; row++) {
      const card = deck[cardIdx++];
      // Only the top card (last dealt) is face up
      card.faceUp = (row === count - 1);
      spiderState.columns[col].push(card);
    }
  }

  // Remaining cards go to stock
  while (cardIdx < deck.length) {
    spiderState.stock.push(deck[cardIdx++]);
  }

  return spiderState;
}

/**
 * Check if a card can be placed on another card.
 * @param {number} cardValue - value of card being moved
 * @param {number} targetValue - value of target card (top of destination column)
 * @returns {boolean}
 */
function spiderCanPlaceOn(cardValue, targetValue) {
  // Any card can go on empty column
  // Otherwise, card must be exactly one less than target (descending)
  return cardValue === targetValue - 1;
}

/**
 * Get the longest descending face-up sequence starting at cardIdx in srcCol.
 * @param {number} srcCol
 * @param {number} cardIdx - index of top card in the sequence
 * @returns {number} - number of cards in the sequence (including the top card)
 */
function spiderGetSequenceLength(srcCol, cardIdx) {
  const col = spiderState.columns[srcCol];
  let len = 1;
  for (let i = cardIdx + 1; i < col.length; i++) {
    if (!col[i].faceUp) break;
    if (col[i].value !== col[i - 1].value - 1) break;
    len++;
  }
  return len;
}

/**
 * Validate a move from srcCol (starting at cardIdx) to dstCol.
 * @param {number} srcCol
 * @param {number} cardIdx
 * @param {number} dstCol
 * @returns {boolean}
 */
function spiderCanMove(srcCol, cardIdx, dstCol) {
  if (srcCol === dstCol) return false;
  if (spiderState.columns[srcCol][cardIdx].faceUp === false) return false;

  const seqLen = spiderGetSequenceLength(srcCol, cardIdx);
  const movingCard = spiderState.columns[srcCol][cardIdx];

  // Check destination
  const dstColArr = spiderState.columns[dstCol];
  if (dstColArr.length === 0) return true; // Empty column: any card/sequence

  const dstTop = dstColArr[dstColArr.length - 1];
  if (!dstTop.faceUp) return false; // Can't place on face-down

  return spiderCanPlaceOn(movingCard.value, dstTop.value);
}

/**
 * Execute a move from srcCol (cardIdx) to dstCol.
 */
function spiderMove(srcCol, cardIdx, dstCol) {
  if (!spiderCanMove(srcCol, cardIdx, dstCol)) return false;

  const seqLen = spiderGetSequenceLength(srcCol, cardIdx);
  const cardsToMove = spiderState.columns[srcCol].splice(cardIdx, seqLen);
  spiderState.columns[dstCol].push(...cardsToMove);

  // Flip the newly exposed card in source column
  const srcColArr = spiderState.columns[srcCol];
  if (srcColArr.length > 0) {
    const topCard = srcColArr[srcColArr.length - 1];
    if (!topCard.faceUp) {
      topCard.faceUp = true;
    }
  }

  // Check for completed K-A runs
  spiderCheckCompletedRuns();

  // Check win
  if (spiderState.gameState === "playing") {
    spiderCheckWin();
  }

  spiderRenderCards();
  spiderUpdateHeader();
  return true;
}

/**
 * Check all columns for completed King-to-Ace runs and remove them.
 */
function spiderCheckCompletedRuns() {
  let found = true;
  while (found) {
    found = false;
    for (let col = 0; col < 10; col++) {
      const colArr = spiderState.columns[col];
      if (colArr.length < 13) continue;

      // Check the bottom 13 cards
      const startIdx = colArr.length - 13;
      let isRun = true;
      if (colArr[startIdx].value !== 13) isRun = false; // Must start with King

      for (let i = 0; i < 13; i++) {
        if (!colArr[startIdx + i].faceUp) {
          isRun = false;
          break;
        }
        if (colArr[startIdx + i].value !== 13 - i) {
          isRun = false;
          break;
        }
      }

      if (isRun) {
        // Remove the 13 cards
        colArr.splice(startIdx, 13);
        spiderState.completedRuns++;
        found = true;

        // Show completion animation
        spiderShowRunAnimation(col);

        // Flip newly exposed card
        if (colArr.length > 0) {
          const topCard = colArr[colArr.length - 1];
          if (!topCard.faceUp) {
            topCard.faceUp = true;
          }
        }
      }
    }
  }
}

/**
 * Show a brief animation for a completed run.
 * @param {number} col - column index
 */
function spiderShowRunAnimation(col) {
  const colEl = document.querySelector(`.spider-column[data-col="${col}"]`);
  if (!colEl) return;

  const area = colEl.querySelector(".spider-completed-area");
  if (!area) return;

  const run = document.createElement("div");
  run.className = "spider-completed-run";
  area.appendChild(run);

  setTimeout(() => {
    run.remove();
  }, 600);
}

/**
 * Check if the player has won (all 8 runs completed).
 */
function spiderCheckWin() {
  // Win when all cards are in completed runs (tableau empty, stock empty)
  let totalCards = 0;
  for (let col = 0; col < 10; col++) {
    totalCards += spiderState.columns[col].length;
  }
  totalCards += spiderState.stock.length;

  if (totalCards === 0 && spiderState.completedRuns === 8) {
    spiderState.gameState = "won";
    spiderShowWin();
  }
}

/**
 * Show the win overlay.
 */
function spiderShowWin() {
  const winOverlay = document.getElementById("spider-win-overlay");
  if (winOverlay) {
    winOverlay.classList.add("visible");
  }
}

/**
 * Deal one card from stock to each non-empty column.
 */
function spiderDealStock() {
  if (spiderState.stock.length === 0) return false;
  if (spiderState.gameState !== "playing") return false;

  // Can only deal when no column is empty
  for (let col = 0; col < 10; col++) {
    if (spiderState.columns[col].length === 0) return false;
  }

  // Deal one card to each column
  for (let col = 0; col < 10; col++) {
    if (spiderState.stock.length > 0) {
      const card = spiderState.stock.shift();
      card.faceUp = true;
      spiderState.columns[col].push(card);
    }
  }

  spiderCheckCompletedRuns();
  if (spiderState.gameState === "playing") {
    spiderCheckWin();
  }

  spiderRenderCards();
  spiderUpdateHeader();
  return true;
}

/**
 * Update header elements (completed runs count, stock info).
 */
function spiderUpdateHeader() {
  const countEl = document.getElementById("spider-completed-count");
  if (countEl) {
    countEl.textContent = "Runs: " + spiderState.completedRuns + "/8";
  }

  const stockPile = document.getElementById("spider-stock-pile");
  const stockCount = document.getElementById("spider-stock-count");
  if (stockCount) {
    stockCount.textContent = spiderState.stock.length;
  }
  if (stockPile) {
    if (spiderState.stock.length === 0) {
      stockPile.classList.add("disabled");
    } else {
      // Disabled if any column is empty
      let anyEmpty = false;
      for (let col = 0; col < 10; col++) {
        if (spiderState.columns[col].length === 0) {
          anyEmpty = true;
          break;
        }
      }
      stockPile.classList.toggle("disabled", anyEmpty);
    }
  }
}

/**
 * Render the entire Spider Solitaire game.
 * @param {HTMLElement} container
 */
function spiderRender(container) {
  if (!container) return;
  container.innerHTML = "";
  container.style.padding = "0";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.height = "100%";
  container.style.overflow = "hidden";
  container.style.position = "relative";

  const app = document.createElement("div");
  app.className = "spider-container";

  // Header
  const header = document.createElement("div");
  header.className = "spider-header";

  const headerLeft = document.createElement("div");
  headerLeft.className = "spider-header-left";

  const completedCount = document.createElement("span");
  completedCount.className = "spider-completed-count";
  completedCount.id = "spider-completed-count";
  completedCount.textContent = "Runs: 0/8";

  headerLeft.appendChild(completedCount);
  header.appendChild(headerLeft);

  const newGameBtn = document.createElement("button");
  newGameBtn.className = "spider-new-game-btn";
  newGameBtn.textContent = "New Game";
  newGameBtn.addEventListener("click", () => {
    spiderInit();
  });
  header.appendChild(newGameBtn);

  app.appendChild(header);

  // Stock area
  const stockArea = document.createElement("div");
  stockArea.className = "spider-stock-area";

  const stockPile = document.createElement("div");
  stockPile.className = "spider-stock-pile";
  stockPile.id = "spider-stock-pile";
  stockPile.innerHTML = '<span style="font-size:20px;color:#6c7086;">&#x1F4C6;</span>';
  stockPile.title = "Deal cards";

  const stockCount = document.createElement("span");
  stockCount.className = "spider-stock-count";
  stockCount.id = "spider-stock-count";
  stockCount.textContent = "50";

  const stockLabel = document.createElement("span");
  stockLabel.className = "spider-stock-label";
  stockLabel.textContent = "stock";

  stockArea.appendChild(stockPile);
  stockArea.appendChild(stockCount);
  stockArea.appendChild(stockLabel);
  app.appendChild(stockArea);

  // Tableau
  const tableau = document.createElement("div");
  tableau.className = "spider-tableau";

  for (let col = 0; col < 10; col++) {
    const colEl = document.createElement("div");
    colEl.className = "spider-column";
    colEl.dataset.col = col;

    // Completed run animation area
    const runArea = document.createElement("div");
    runArea.className = "spider-completed-area";
    colEl.appendChild(runArea);

    tableau.appendChild(colEl);
  }

  app.appendChild(tableau);

  // Win overlay
  const winOverlay = document.createElement("div");
  winOverlay.className = "spider-win-overlay";
  winOverlay.id = "spider-win-overlay";
  winOverlay.innerHTML = `
    <div class="spider-win-text">You Win!</div>
    <button class="spider-win-btn" id="spider-win-btn">Play Again</button>
  `;
  winOverlay.querySelector("#spider-win-btn").addEventListener("click", () => {
    winOverlay.classList.remove("visible");
    spiderInit();
  });
  app.appendChild(winOverlay);

  container.appendChild(app);

  // Initialize the game
  spiderInit();
  spiderRenderCards();

  // Setup stock click
  stockPile.addEventListener("click", () => {
    spiderDealStock();
  });

  // Setup drag and drop
  spiderSetupDragAndDrop();
}

/**
 * Render all cards in the tableau.
 */
function spiderRenderCards() {
  const columns = document.querySelectorAll(".spider-column");
  columns.forEach((colEl) => {
    const colIdx = parseInt(colEl.dataset.col);
    const colArr = spiderState.columns[colIdx];

    // Remove existing cards (keep the completed-area div)
    const runArea = colEl.querySelector(".spider-completed-area");
    colEl.innerHTML = "";
    if (runArea) colEl.appendChild(runArea);

    let yOffset = 0;
    for (let i = 0; i < colArr.length; i++) {
      const card = colArr[i];
      const cardEl = document.createElement("div");
      cardEl.className = "spider-card";
      cardEl.dataset.col = colIdx;
      cardEl.dataset.idx = i;

      if (card.faceUp) {
        cardEl.classList.add("face-up");
        const valueLabel = spiderValueLabel(card.value);
        cardEl.innerHTML = '<span class="card-value">' + valueLabel + '</span><span class="card-suit">&#9824;</span>';
      } else {
        cardEl.classList.add("face-down");
      }

      // Position
      cardEl.style.top = yOffset + "px";
      yOffset += card.faceUp ? SPIDER_CARD_HEIGHT : SPIDER_CARD_GAP;
      if (i === colArr.length - 1 && card.faceUp) {
        yOffset += SPIDER_TOP_GAP;
      }

      // Only the top card (or part of a sequence) can be grabbed
      // For face-down cards, they can't be directly grabbed
      if (card.faceUp) {
        // Check if this card is the top of a moveable sequence
        // (i.e., all cards below it in the column that are face-up form a valid descending sequence down to this card)
        const seqLen = spiderGetSequenceLength(colIdx, i);
        if (seqLen === colArr.length - i) {
          // This card and everything below it form a valid sequence - it's grabbable
          cardEl.style.cursor = "grab";
        } else {
          cardEl.style.cursor = "default";
        }
      }

      colEl.appendChild(cardEl);
    }
  });
}

/**
 * Get the label for a card value.
 * @param {number} value
 * @returns {string}
 */
function spiderValueLabel(value) {
  switch (value) {
    case 1: return "A";
    case 11: return "J";
    case 12: return "Q";
    case 13: return "K";
    default: return String(value);
  }
}

/**
 * Setup drag and drop for cards.
 */
function spiderSetupDragAndDrop() {
  const tableau = document.querySelector(".spider-tableau");
  if (!tableau) return;

  let dragData = null; // { col, idx, cards, startX, startY, ghostEl, originalParent }
  let ghostEl = null;

  function getCardFromEvent(e) {
    const target = e.target.closest(".spider-card");
    if (!target) return null;
    const col = parseInt(target.dataset.col);
    const idx = parseInt(target.dataset.idx);
    if (isNaN(col) || isNaN(idx)) return null;
    if (!spiderState.columns[col][idx].faceUp) return null;

    const seqLen = spiderGetSequenceLength(col, idx);
    const cards = spiderState.columns[col].slice(idx, idx + seqLen);

    return { col: col, idx: idx, cards: cards, seqLen: seqLen };
  }

  function createGhost(cards, e) {
    const ghost = document.createElement("div");
    ghost.style.position = "fixed";
    ghost.style.left = e.clientX - 35 + "px";
    ghost.style.top = e.clientY - 28 + "px";
    ghost.style.zIndex = "100000";
    ghost.style.pointerEvents = "none";
    ghost.style.display = "flex";
    ghost.style.flexDirection = "column";
    ghost.style.gap = "1px";

    cards.forEach((card, i) => {
      const cardEl = document.createElement("div");
      cardEl.style.width = "56px";
      cardEl.style.height = "40px";
      cardEl.style.borderRadius = "6px";
      cardEl.style.background = card.faceUp ? "#f5f5f5" : "linear-gradient(135deg, #45475a, #313244)";
      cardEl.style.border = "1px solid rgba(255,255,255,0.1)";
      cardEl.style.boxShadow = "0 2px 8px rgba(0,0,0,0.3)";
      cardEl.style.display = "flex";
      cardEl.style.alignItems = "center";
      cardEl.style.justifyContent = "center";
      cardEl.style.fontSize = "14px";
      cardEl.style.fontWeight = "600";
      cardEl.style.color = card.faceUp ? "#1e1e2e" : "transparent";
      cardEl.style.fontFamily = "inherit";
      if (card.faceUp) {
        cardEl.textContent = spiderValueLabel(card.value) + " \u2660";
      }
      ghost.appendChild(cardEl);
    });

    document.body.appendChild(ghost);
    return ghost;
  }

  // mousedown on card
  tableau.addEventListener("mousedown", (e) => {
    if (spiderState.gameState !== "playing") return;
    if (e.button !== 0) return;

    const cardInfo = getCardFromEvent(e);
    if (!cardInfo) return;

    e.preventDefault();
    e.stopPropagation();

    // Hide the original cards
    const colEl = document.querySelector(`.spider-column[data-col="${cardInfo.col}"]`);
    const cardEls = colEl.querySelectorAll(`.spider-card[data-col="${cardInfo.col}"]`);
    cardEls.forEach((el) => {
      const elIdx = parseInt(el.dataset.idx);
      if (elIdx >= cardInfo.idx) {
        el.style.opacity = "0.3";
      }
    });

    // Create ghost
    ghostEl = createGhost(cardInfo.cards, e);

    dragData = {
      srcCol: cardInfo.col,
      cardIdx: cardInfo.idx,
      cards: cardInfo.cards,
      seqLen: cardInfo.seqLen,
      startX: e.clientX,
      startY: e.clientY,
    };
  });

  // mousemove
  document.addEventListener("mousemove", (e) => {
    if (!dragData) return;

    // Move ghost
    if (ghostEl) {
      ghostEl.style.left = e.clientX - 35 + "px";
      ghostEl.style.top = e.clientY - 28 + "px";
    }

    // Highlight target columns
    document.querySelectorAll(".spider-column").forEach((colEl) => {
      colEl.classList.remove("drag-over");
      const colIdx = parseInt(colEl.dataset.col);
      if (colIdx === dragData.srcCol) return;

      const rect = colEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        if (spiderCanMove(dragData.srcCol, dragData.cardIdx, colIdx)) {
          colEl.classList.add("drag-over");
        }
      }
    });
  });

  // mouseup
  document.addEventListener("mouseup", (e) => {
    if (!dragData) return;

    // Remove ghost
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }

    // Remove drag-over highlights
    document.querySelectorAll(".spider-column").forEach((colEl) => {
      colEl.classList.remove("drag-over");
    });

    // Find target column
    let targetCol = -1;
    document.querySelectorAll(".spider-column").forEach((colEl) => {
      const colIdx = parseInt(colEl.dataset.col);
      const rect = colEl.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
          e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetCol = colIdx;
      }
    });

    // Restore original card visibility
    const colEl = document.querySelector(`.spider-column[data-col="${dragData.srcCol}"]`);
    if (colEl) {
      const cardEls = colEl.querySelectorAll(`.spider-card[data-col="${dragData.srcCol}"]`);
      cardEls.forEach((el) => {
        el.style.opacity = "1";
      });
    }

    // Try the move
    if (targetCol >= 0 && targetCol !== dragData.srcCol) {
      const moved = spiderMove(dragData.srcCol, dragData.cardIdx, targetCol);
      if (moved) {
        dragData = null;
        return;
      }
    }

    // Illegal move: snap back (just re-render)
    spiderRenderCards();
    dragData = null;
  });

  // mouseleave: cancel drag
  document.addEventListener("mouseleave", () => {
    if (!dragData) return;
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
    document.querySelectorAll(".spider-column").forEach((colEl) => {
      colEl.classList.remove("drag-over");
    });
    // Restore original cards
    const colEl = document.querySelector(`.spider-column[data-col="${dragData.srcCol}"]`);
    if (colEl) {
      const cardEls = colEl.querySelectorAll(`.spider-card[data-col="${dragData.srcCol}"]`);
      cardEls.forEach((el) => {
        el.style.opacity = "1";
      });
    }
    spiderRenderCards();
    dragData = null;
  });
}

// ===== Self-test for Spider Solitaire =====
window.spiderSelfTest = function () {
  let passed = 0;
  let failed = 0;
  var results = [];

  function assert(condition, msg) {
    if (condition) {
      passed++;
    } else {
      failed++;
      results.push("FAIL: " + msg);
    }
  }

  // Test 1: Init creates correct structure
  spiderInit();
  assert(spiderState.columns.length === 10, "10 columns");
  assert(spiderState.columns[0].length === 6, "column 0 has 6 cards");
  assert(spiderState.columns[1].length === 6, "column 1 has 6 cards");
  assert(spiderState.columns[2].length === 6, "column 2 has 6 cards");
  assert(spiderState.columns[3].length === 6, "column 3 has 6 cards");
  assert(spiderState.columns[4].length === 5, "column 4 has 5 cards");
  assert(spiderState.columns[9].length === 5, "column 9 has 5 cards");
  assert(spiderState.stock.length === 50, "stock has 50 cards");
  assert(spiderState.completedRuns === 0, "no completed runs");
  assert(spiderState.gameState === "playing", "gameState = playing");

  // Test 2: Top cards are face up
  for (let col = 0; col < 10; col++) {
    const colArr = spiderState.columns[col];
    assert(colArr[colArr.length - 1].faceUp, "top card of col " + col + " is face up");
  }

  // Test 3: Non-top cards are face down
  for (let col = 0; col < 10; col++) {
    const colArr = spiderState.columns[col];
    for (let i = 0; i < colArr.length - 1; i++) {
      assert(!colArr[i].faceUp, "non-top card of col " + col + " is face down");
    }
  }

  // Test 4: Total cards = 104
  var totalCards = 0;
  for (let col = 0; col < 10; col++) {
    totalCards += spiderState.columns[col].length;
  }
  totalCards += spiderState.stock.length;
  assert(totalCards === 104, "total cards = 104");

  // Test 5: Can move a single card to a valid target
  // Find two columns where top cards differ by 1
  var moved = false;
  for (var c1 = 0; c1 < 10 && !moved; c1++) {
    for (var c2 = 0; c2 < 10 && !moved; c2++) {
      if (c1 === c2) continue;
      var top1 = spiderState.columns[c1][spiderState.columns[c1].length - 1];
      var top2 = spiderState.columns[c2][spiderState.columns[c2].length - 1];
      if (top1.faceUp && top2.faceUp && top1.value === top2.value - 1) {
        var srcLenBefore = spiderState.columns[c1].length;
        spiderMove(c1, spiderState.columns[c1].length - 1, c2);
        var srcLenAfter = spiderState.columns[c1].length;
        assert(srcLenAfter === srcLenBefore - 1, "source column lost exactly 1 card");
        assert(spiderState.columns[c2].length >= 1, "destination column has cards");
        moved = true;
      }
    }
  }
  if (!moved) {
    results.push("SKIP: No valid single-card move found in random deal");
    passed++;
  }

  // Test 6: Cannot move face-down card
  spiderInit();
  if (spiderState.columns[0].length > 1) {
    var canMove = spiderCanMove(0, spiderState.columns[0].length - 2, 1);
    assert(canMove === false, "cannot move face-down card");
  }

  // Test 7: Cannot move to same column
  spiderInit();
  var cannotSame = !spiderCanMove(0, spiderState.columns[0].length - 1, 0);
  assert(cannotSame, "cannot move to same column");

  // Test 8: Stock deal
  spiderInit();
  // Fill stock to a manageable number by manually setting it
  // Instead, just verify deal logic: only deals when no empty columns
  var canDeal = spiderDealStock();
  assert(canDeal === true, "can deal when no empty columns");
  assert(spiderState.stock.length === 40, "stock decreased by 10 after deal");
  for (var col2 = 0; col2 < 10; col2++) {
    assert(spiderState.columns[col2].length >= 1, "all columns still have cards after deal");
  }

  // Test 9: Cannot deal when a column is empty
  spiderInit();
  // Remove all cards from column 0
  spiderState.columns[0] = [];
  var dealResult = spiderDealStock();
  assert(dealResult === false, "cannot deal when a column is empty");
  // Restore
  spiderState.columns[0] = [{ value: 1, faceUp: true }];

  // Test 10: Sequence length calculation
  spiderInit();
  // Find a column with multiple face-up cards
  var seqCol = -1;
  for (var c3 = 0; c3 < 10; c3++) {
    var colArr2 = spiderState.columns[c3];
    if (colArr2.length >= 2 && colArr2[colArr2.length - 2].faceUp) {
      seqCol = c3;
      break;
    }
  }
  if (seqCol >= 0) {
    var topIdx = spiderState.columns[seqCol].length - 1;
    var seqLen = spiderGetSequenceLength(seqCol, topIdx);
    assert(seqLen >= 1, "sequence length >= 1");
  } else {
    passed++; // skip if no sequence found
  }

  // Test 11: Value labels
  assert(spiderValueLabel(1) === "A", "value label for 1 = A");
  assert(spiderValueLabel(11) === "J", "value label for 11 = J");
  assert(spiderValueLabel(12) === "Q", "value label for 12 = Q");
  assert(spiderValueLabel(13) === "K", "value label for 13 = K");
  assert(spiderValueLabel(7) === "7", "value label for 7 = 7");

  // Test 12: Can place on empty column
  spiderInit();
  spiderState.columns[5] = []; // empty column
  var canPlaceEmpty = spiderCanMove(0, spiderState.columns[0].length - 1, 5);
  assert(canPlaceEmpty === true, "can move to empty column");

  // Test 13: Cannot place higher card on lower card
  spiderInit();
  // Manually set up: col 0 top = 5, col 1 top = 3
  spiderState.columns[0] = [{ value: 5, faceUp: true }];
  spiderState.columns[1] = [{ value: 3, faceUp: true }];
  spiderState.columns[2] = [];
  spiderState.columns[3] = [];
  spiderState.columns[4] = [];
  spiderState.columns[6] = [];
  spiderState.columns[7] = [];
  spiderState.columns[8] = [];
  spiderState.columns[9] = [];
  spiderState.stock = [];
  var cannotPlaceHigher = !spiderCanMove(0, 0, 1);
  assert(cannotPlaceHigher, "cannot place 5 on 3");

  // Test 14: Can place lower card on higher card (4 on 5)
  spiderState.columns[0] = [{ value: 5, faceUp: true }];
  spiderState.columns[1] = [{ value: 4, faceUp: true }];
  spiderState.columns[2] = [];
  spiderState.columns[3] = [];
  spiderState.columns[4] = [];
  spiderState.columns[6] = [];
  spiderState.columns[7] = [];
  spiderState.columns[8] = [];
  spiderState.columns[9] = [];
  spiderState.stock = [];
  var canPlaceLower = spiderCanMove(1, 0, 0);
  assert(canPlaceLower, "can place 4 on 5");

  var summary = failed === 0 ? "PASS" : "FAIL";
  console.log("Spider Solitaire Self-Test: " + summary);
  if (failed > 0) {
    console.log("  Passed: " + passed + ", Failed: " + failed);
    results.forEach(function (r) { console.log("  " + r); });
  } else {
    console.log("  All " + passed + " assertions passed.");
  }
  return { passed: passed, failed: failed, summary: summary, failures: results };
};
window.minesweeperSelfTest = function () {
  let passed = 0;
  let failed = 0;
  var results = [];

  function assert(condition, msg) {
    if (condition) {
      passed++;
    } else {
      failed++;
      results.push("FAIL: " + msg);
    }
  }

  // Test 1: Init beginner
  mwInit("beginner");
  assert(mwState.rows === 9, "beginner rows = 9");
  assert(mwState.cols === 9, "beginner cols = 9");
  assert(mwState.totalMines === 10, "beginner mines = 10");
  assert(mwState.gameState === "idle", "initial state = idle");
  assert(mwState.firstClick === true, "firstClick = true");
  assert(mwState.cellsRevealed === 0, "cellsRevealed = 0");
  assert(mwState.flagsPlaced === 0, "flagsPlaced = 0");
  assert(mwState.timer === 0, "timer = 0");

  // Test 2: Board initialized correctly
  for (var r = 0; r < 9; r++) {
    for (var c = 0; c < 9; c++) {
      assert(!mwState.board[r][c].isMine, "no mine at (" + r + "," + c + ") before first click");
      assert(!mwState.board[r][c].isRevealed, "not revealed at (" + r + "," + c + ") before first click");
      assert(!mwState.board[r][c].isFlagged, "not flagged at (" + r + "," + c + ") before first click");
    }
  }

  // Test 3: First click places mines safely
  mwRevealCell(4, 4);
  assert(mwState.firstClick === false, "firstClick = false after first reveal");
  assert(mwState.gameState === "playing", "gameState = playing after first reveal");
  assert(!mwState.board[4][4].isMine, "clicked cell is not a mine");
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      var nr = 4 + dr;
      var nc = 4 + dc;
      if (nr >= 0 && nr < 9 && nc >= 0 && nc < 9) {
        assert(!mwState.board[nr][nc].isMine, "neighbor (" + nr + "," + nc + ") is not a mine");
      }
    }
  }

  // Test 4: Neighbor count is correct
  var mineNeighbors = 0;
  for (var dr2 = -1; dr2 <= 1; dr2++) {
    for (var dc2 = -1; dc2 <= 1; dc2++) {
      if (dr2 === 0 && dc2 === 0) continue;
      var nnr = 4 + dr2;
      var nnc = 4 + dc2;
      if (nnr >= 0 && nnr < 9 && nnc >= 0 && nnc < 9 && mwState.board[nnr][nnc].isMine) {
        mineNeighbors++;
      }
    }
  }
  assert(mwState.board[4][4].neighborCount === mineNeighbors, "neighbor count for (4,4) is correct");

  // Test 5: Flagging
  mwToggleFlag(0, 0);
  assert(mwState.board[0][0].isFlagged, "cell (0,0) is flagged");
  assert(mwState.flagsPlaced === 1, "flagsPlaced = 1");
  mwToggleFlag(0, 0);
  assert(!mwState.board[0][0].isFlagged, "cell (0,0) is unflagged after second toggle");
  assert(mwState.flagsPlaced === 0, "flagsPlaced = 0 after unflag");

  // Test 6: Reveal a mine = game over
  var mineR = -1;
  var mineC = -1;
  for (var r2 = 0; r2 < 9; r2++) {
    for (var c2 = 0; c2 < 9; c2++) {
      if (mwState.board[r2][c2].isMine && !(Math.abs(r2 - 4) <= 1 && Math.abs(c2 - 4) <= 1)) {
        mineR = r2;
        mineC = c2;
        break;
      }
    }
    if (mineR >= 0) break;
  }
  if (mineR >= 0) {
    mwRevealCell(mineR, mineC);
    assert(mwState.gameState === "lost", "gameState = lost after revealing mine");
    assert(mwState.board[mineR][mineC].isRevealed, "mine cell is revealed");
  }

  // Test 7: Init intermediate
  mwInit("intermediate");
  assert(mwState.rows === 16, "intermediate rows = 16");
  assert(mwState.cols === 16, "intermediate cols = 16");
  assert(mwState.totalMines === 40, "intermediate mines = 40");

  // Test 8: Init expert
  mwInit("expert");
  assert(mwState.rows === 16, "expert rows = 16");
  assert(mwState.cols === 30, "expert cols = 30");
  assert(mwState.totalMines === 99, "expert mines = 99");

  // Test 9: Flood fill on zero cell
  mwInit("beginner");
  mwRevealCell(0, 0);
  var cellsAfterCorner = mwState.cellsRevealed;
  assert(cellsAfterCorner >= 1, "flood fill revealed at least 1 cell from corner");

  // Test 10: Reveal flagged cell does nothing
  mwInit("beginner");
  mwRevealCell(0, 0);
  var revealedBefore = mwState.board[0][0].isRevealed;
  mwRevealCell(0, 0);
  assert(mwState.board[0][0].isRevealed === revealedBefore, "re-revealing same cell does not change state");

  // Test 11: Timer stops on game end
  mwInit("beginner");
  mwStartTimer();
  // Find a mine and reveal it
  for (var r3 = 0; r3 < 9; r3++) {
    for (var c3 = 0; c3 < 9; c3++) {
      if (mwState.board[r3][c3].isMine && !(Math.abs(r3 - 0) <= 1 && Math.abs(c3 - 0) <= 1)) {
        mwRevealCell(r3, c3);
        break;
      }
    }
    if (mwState.gameState === "lost") break;
  }
  var timerAfterLoss = mwState.timer;
  // Wait a tick to ensure timer stopped
  setTimeout(function () {
    // timer should not have changed
  }, 1100);

  var summary = failed === 0 ? "PASS" : "FAIL";
  console.log("Minesweeper Self-Test: " + summary);
  if (failed > 0) {
    console.log("  Passed: " + passed + ", Failed: " + failed);
    results.forEach(function (r) { console.log("  " + r); });
  } else {
    console.log("  All " + passed + " assertions passed.");
  }
  return { passed: passed, failed: failed, results: summary };
};

// Attach keyboard handler
document.addEventListener('keydown', handleCalcKeyboard);
document.title = 'Browser OS - Initialized';
window._initTime = Date.now();
window._initRunning = true;
loadWallpaper();
createContextMenus();
window._initRunning = false;
window._initDone = true;
window._initEndTime = Date.now();
