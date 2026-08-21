/**
 * Browser OS — script.js
 * 
 * Ticket 1: Desktop shell — Window manager and taskbar.
 * 
 * Architecture:
 * - WindowRegistry: manages all open windows, z-order, focus.
 * - Taskbar: renders buttons for each open window, shows clock.
 * - Desktop icons: double-click to open app windows.
 * - Drag and resize for windows.
 */

(function () {
  'use strict';

  // ===== Configuration =====
  const WINDOW_START_X = 60;
  const WINDOW_START_Y = 40;
  const WINDOW_SPACING = 24;
  const MIN_WINDOW_WIDTH = 300;
  const MIN_WINDOW_HEIGHT = 200;
  const TASKBAR_HEIGHT = 48;

  // ===== Global state =====
  let currentZIndex = 100;
  let nextWindowOffset = 0;

  // ===== Window Registry =====
  const WindowRegistry = {
    /** @type {Map<string, WindowRecord>} */
    windows: new Map(),

    /**
     * @typedef {Object} WindowRecord
     * @property {string} appId
     * @property {string} title
     * @property {HTMLElement} element
     * @property {number} x
     * @property {number} y
     * @property {number} width
     * @property {number} height
     * @property {boolean} maximized
     */

    /**
     * Register a new window.
     * @param {string} appId - Unique app identifier
     * @param {string} title - Window title
     * @param {number} width - Window width
     * @param {number} height - Window height
     * @param {Function} renderBody - Function to render the window body content
     * @returns {WindowRecord}
     */
    register(appId, title, width, height, renderBody) {
      // Single instance per app: if already open, focus and return
      if (this.windows.has(appId)) {
        const existing = this.windows.get(appId);
        this.focus(appId);
        return existing;
      }

      const { x, y } = this._getNextPosition(width, height);

      const el = this._createWindowElement(appId, title, x, y, width, height);
      if (renderBody) {
        renderBody(el.querySelector('.window-body'));
      }

      document.getElementById('windows-container').appendChild(el);

      const record = {
        appId,
        title,
        element: el,
        x,
        y,
        width,
        height,
        maximized: false
      };

      this.windows.set(appId, record);
      this.focus(appId);
      Taskbar.sync();
      return record;
    },

    /**
     * @param {string} appId
     */
    close(appId) {
      const record = this.windows.get(appId);
      if (!record) return;

      record.element.remove();
      this.windows.delete(appId);
      Taskbar.sync();
    },

    /**
     * @param {string} appId
     */
    focus(appId) {
      const record = this.windows.get(appId);
      if (!record) return;

      // De-focus all windows
      this.windows.forEach((rec) => {
        rec.element.classList.remove('focused');
        rec.element.style.zIndex = parseInt(rec.element.style.zIndex, 10) || 100;
      });

      // Focus this window
      currentZIndex++;
      record.element.style.zIndex = currentZIndex;
      record.element.classList.add('focused');

      // Update taskbar
      Taskbar.sync();
    },

    /**
     * @param {string} appId
     */
    isFocused(appId) {
      const record = this.windows.get(appId);
      if (!record) return false;
      return record.element.classList.contains('focused');
    },

    /**
     * @param {string} appId
     */
    exists(appId) {
      return this.windows.has(appId);
    },

    /**
     * @param {number} width
     * @param {number} height
     * @returns {{x: number, y: number}}
     */
    _getNextPosition(width, height) {
      const desktopEl = document.getElementById('desktop');
      const desktopW = desktopEl.clientWidth;
      const desktopH = desktopEl.clientHeight;

      // Stagger windows
      const ox = (nextWindowOffset % 8) * WINDOW_SPACING;
      const oy = (nextWindowOffset % 8) * WINDOW_SPACING;
      nextWindowOffset++;

      let x = WINDOW_START_X + ox;
      let y = WINDOW_START_Y + oy;

      // Constrain to viewport
      if (x + width > desktopW - 10) x = Math.max(10, desktopW - width - 10);
      if (y + height > desktopH - 10) y = Math.max(10, desktopH - height - 10);
      if (x < 10) x = 10;
      if (y < 10) y = 10;

      return { x, y };
    },

    /**
     * @param {string} appId
     * @param {string} title
     * @param {number} x
     * @param {number} y
     * @param {number} width
     * @param {number} height
     * @returns {HTMLElement}
     */
    _createWindowElement(appId, title, x, y, width, height) {
      const el = document.createElement('div');
      el.className = 'window focused';
      el.dataset.appId = appId;
      el.style.left = x + 'px';
      el.style.top = y + 'px';
      el.style.width = width + 'px';
      el.style.height = height + 'px';
      el.style.zIndex = ++currentZIndex;

      // Title bar
      const titlebar = document.createElement('div');
      titlebar.className = 'window-titlebar';

      const titleText = document.createElement('span');
      titleText.className = 'window-titlebar-text';
      titleText.textContent = title;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'window-close-btn';
      closeBtn.innerHTML = '&#x2715;';
      closeBtn.title = 'Close';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.close(appId);
      });

      titlebar.appendChild(titleText);
      titlebar.appendChild(closeBtn);

      // Window body
      const body = document.createElement('div');
      body.className = 'window-body';

      // Resize handle
      const resizeHandle = document.createElement('div');
      resizeHandle.className = 'window-resize-handle';

      el.appendChild(titlebar);
      el.appendChild(body);
      el.appendChild(resizeHandle);

      // --- Drag logic ---
      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;
      let winStartX = 0;
      let winStartY = 0;

      titlebar.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('window-close-btn')) return;
        e.preventDefault();
        isDragging = true;
        this.focus(appId);

        dragStartX = e.clientX;
        dragStartY = e.clientY;
        winStartX = parseInt(el.style.left, 10);
        winStartY = parseInt(el.style.top, 10);

        const onMove = (ev) => {
          if (!isDragging) return;
          let newX = winStartX + (ev.clientX - dragStartX);
          let newY = winStartY + (ev.clientY - dragStartY);

          // Constrain to viewport
          const desktopEl = document.getElementById('desktop');
          const desktopH = desktopEl.clientHeight;
          const maxTop = desktopH - height;
          if (newY > maxTop) newY = maxTop;
          if (newY < 0) newY = 0;
          if (newX < 0) newX = 0;
          const maxX = desktopEl.clientWidth - width;
          if (newX > maxX) newX = maxX;

          el.style.left = newX + 'px';
          el.style.top = newY + 'px';
          record.x = newX;
          record.y = newY;
        };

        const onUp = () => {
          isDragging = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // --- Resize logic ---
      let isResizing = false;
      let resizeStartX = 0;
      let resizeStartY = 0;
      let resizeStartW = 0;
      let resizeStartH = 0;

      resizeHandle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isResizing = true;
        this.focus(appId);

        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartW = width;
        resizeStartH = height;

        const onMove = (ev) => {
          if (!isResizing) return;
          let newW = Math.max(MIN_WINDOW_WIDTH, resizeStartW + (ev.clientX - resizeStartX));
          let newH = Math.max(MIN_WINDOW_HEIGHT, resizeStartH + (ev.clientY - resizeStartY));

          el.style.width = newW + 'px';
          el.style.height = newH + 'px';
          record.width = newW;
          record.height = newH;
        };

        const onUp = () => {
          isResizing = false;
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });

      // --- Focus on click ---
      el.addEventListener('mousedown', () => {
        this.focus(appId);
      });

      return el;
    }
  };

  // ===== Taskbar =====
  const Taskbar = {
    /**
     * Rebuild the taskbar button list to match the window registry.
     */
    sync() {
      const container = document.getElementById('taskbar-buttons');
      container.innerHTML = '';

      WindowRegistry.windows.forEach((record) => {
        const btn = document.createElement('button');
        btn.className = 'taskbar-button' + (WindowRegistry.isFocused(record.appId) ? ' active' : '');
        btn.textContent = record.title;

        btn.addEventListener('click', () => {
          if (WindowRegistry.isFocused(record.appId)) {
            // Minimize: unfocus / hide — for simplicity we just minimize
            WindowRegistry.close(record.appId);
          } else {
            WindowRegistry.focus(record.appId);
          }
        });

        container.appendChild(btn);
      });

      Taskbar.updateClock();
    },

    /**
     * Update the clock display.
     */
    updateClock() {
      const clockEl = document.getElementById('taskbar-clock');
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      clockEl.textContent = hours + ':' + minutes;
    }
  };

  // ===== Desktop =====
  const Desktop = {
    init() {
      // Double-click handler for desktop icons
      document.querySelectorAll('.desktop-icon').forEach((icon) => {
        let clickCount = 0;
        let clickTimer = null;

        icon.addEventListener('click', () => {
          clickCount++;
          if (clickCount === 1) {
            clickTimer = setTimeout(() => {
              clickCount = 0;
            }, 300);
          } else if (clickCount === 2) {
            clearTimeout(clickTimer);
            clickCount = 0;
            const appId = icon.dataset.app;
            Desktop.openApp(appId);
          }
        });
      });

      // Context menu on desktop background
      document.getElementById('desktop').addEventListener('contextmenu', (e) => {
        // Only show on empty desktop area (not on icons or windows)
        if (e.target.closest('.desktop-icon') || e.target.closest('.window')) return;
        e.preventDefault();
        Desktop.showContextMenu(e.clientX, e.clientY);
      });

      // Close context menu on click elsewhere
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.context-menu')) {
          Desktop.hideContextMenu();
        }
      });

      // Clock updates every minute
      setInterval(() => Taskbar.updateClock(), 10000);
      Taskbar.updateClock();

      // Initial clock update
      setTimeout(() => Taskbar.updateClock(), 100);
    },

    /**
     * @param {string} appId
     */
    openApp(appId) {
      switch (appId) {
        case 'notepad':
          this._openNotepad();
          break;
        case 'calculator':
          this._openCalculator();
          break;
        case 'minesweeper':
          this._openMinesweeper();
          break;
        case 'spider':
          this._openSpider();
          break;
      }
    },

    /**
     * @param {number} x
     * @param {number} y
     */
    showContextMenu(x, y) {
      const menu = document.getElementById('context-menu');
      const content = document.getElementById('context-menu-content');
      content.innerHTML = '';

      const item = document.createElement('div');
      item.className = 'context-menu-item';
      item.textContent = 'Change wallpaper…';
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        Desktop.hideContextMenu();
        Desktop.showWallpaperPicker();
      });
      content.appendChild(item);

      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
      menu.classList.remove('hidden');

      // Adjust if off-screen
      const rect = menu.getBoundingClientRect();
      if (rect.right > window.innerWidth) {
        menu.style.left = (x - rect.width) + 'px';
      }
      if (rect.bottom > window.innerHeight - TASKBAR_HEIGHT) {
        menu.style.top = (y - rect.height) + 'px';
      }
    },

    hideContextMenu() {
      document.getElementById('context-menu').classList.add('hidden');
    },

    showWallpaperPicker() {
      const menu = document.getElementById('context-menu');
      const content = document.getElementById('context-menu-content');
      content.innerHTML = '';

      // Header
      const header = document.createElement('div');
      header.className = 'wallpaper-picker-header';
      header.textContent = 'Change wallpaper';
      content.appendChild(header);

      // Grid of thumbnails
      const grid = document.createElement('div');
      grid.className = 'wallpaper-picker-grid';

      // Get current wallpaper index
      let currentWallpaper = 0;
      try {
        currentWallpaper = parseInt(localStorage.getItem('browser-os-wallpaper'), 10) || 0;
      } catch (e) { /* ignore */ }

      for (let i = 0; i < 8; i++) {
        const thumb = document.createElement('div');
        thumb.className = 'wallpaper-thumb preview-' + i;
        if (i === currentWallpaper) {
          thumb.classList.add('selected');
        }
        thumb.addEventListener('click', (e) => {
          e.stopPropagation();
          Desktop.setWallpaper(i);
          // Update selection highlight
          grid.querySelectorAll('.wallpaper-thumb').forEach(t => t.classList.remove('selected'));
          thumb.classList.add('selected');
          setTimeout(() => Desktop.hideContextMenu(), 150);
        });
        grid.appendChild(thumb);
      }

      content.appendChild(grid);

      // Position the picker near the bottom of the screen so it's visible
      const pickerWidth = 280;
      const pickerHeight = 180;
      let px = (window.innerWidth - pickerWidth) / 2;
      let py = window.innerHeight - pickerHeight - TASKBAR_HEIGHT - 8;

      menu.style.left = px + 'px';
      menu.style.top = py + 'px';
      menu.classList.remove('hidden');
    },

    /**
     * @param {number} index
     */
    setWallpaper(index) {
      const desktop = document.getElementById('desktop');
      desktop.className = '';
      desktop.classList.add('wallpaper-' + index);
      // Persist in localStorage
      try {
        localStorage.setItem('browser-os-wallpaper', String(index));
      } catch (e) { /* ignore */ }
    }
  };

  // ===== Calculator Module =====
  const Calculator = {
    currentDisplay: '0',
    previousValue: null,
    operator: null,
    waitingForOperand: false,
    expression: '',
    justEvaluated: false,

    /**
     * @param {HTMLElement} body
     */
    init(body) {
      body.id = 'calc-window';
      body.innerHTML = `
        <div class="calc-display">
          <div class="calc-expression"></div>
          <div class="calc-result">0</div>
        </div>
        <div class="calc-buttons">
          <button class="calc-btn clear" data-action="clear">C</button>
          <button class="calc-btn operator" data-action="negate">±</button>
          <button class="calc-btn operator" data-action="percent">%</button>
          <button class="calc-btn operator" data-action="divide">÷</button>
          <button class="calc-btn" data-action="digit" data-value="7">7</button>
          <button class="calc-btn" data-action="digit" data-value="8">8</button>
          <button class="calc-btn" data-action="digit" data-value="9">9</button>
          <button class="calc-btn operator" data-action="multiply">×</button>
          <button class="calc-btn" data-action="digit" data-value="4">4</button>
          <button class="calc-btn" data-action="digit" data-value="5">5</button>
          <button class="calc-btn" data-action="digit" data-value="6">6</button>
          <button class="calc-btn operator" data-action="subtract">−</button>
          <button class="calc-btn" data-action="digit" data-value="1">1</button>
          <button class="calc-btn" data-action="digit" data-value="2">2</button>
          <button class="calc-btn" data-action="digit" data-value="3">3</button>
          <button class="calc-btn operator" data-action="add">+</button>
          <button class="calc-btn" data-action="digit" data-value="0" style="grid-column: span 1;">0</button>
          <button class="calc-btn" data-action="decimal">.</button>
          <button class="calc-btn equals" data-action="equals">=</button>
        </div>
      `;

      this.expressionEl = body.querySelector('.calc-expression');
      this.resultEl = body.querySelector('.calc-result');
      this.buttonsContainer = body.querySelector('.calc-buttons');

      this.bindEvents();
      this.reset();
    },

    bindEvents() {
      // Button clicks
      this.buttonsContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.calc-btn');
        if (!btn) return;
        const action = btn.dataset.action;
        const value = btn.dataset.value;

        if (action === 'digit' || action === 'decimal') {
          this.inputDigit(value, action === 'decimal');
        } else if (action === 'clear') {
          this.clear();
        } else if (action === 'equals') {
          this.evaluate();
        } else if (action === 'negate') {
          this.negate();
        } else if (action === 'percent') {
          this.percent();
        } else if (['add', 'subtract', 'multiply', 'divide'].includes(action)) {
          this.setOperator(action, btn);
        }
      });

      // Keyboard support
      document.addEventListener('keydown', (e) => {
        // Only handle keyboard when calculator window is focused
        if (!WindowRegistry.isFocused('calculator')) return;

        // Prevent default for keys we handle
        const handled = this.handleKey(e);
        if (handled) {
          e.preventDefault();
        }
      });
    },

    /**
     * @param {KeyboardEvent} e
     * @returns {boolean} whether the key was handled
     */
    handleKey(e) {
      const key = e.key;

      if (/^[0-9]$/.test(key)) {
        this.inputDigit(key, false);
        return true;
      }
      if (key === '.') {
        this.inputDigit('.', true);
        return true;
      }
      if (key === '+') {
        this.setOperator('add', null);
        return true;
      }
      if (key === '-') {
        this.setOperator('subtract', null);
        return true;
      }
      if (key === '*') {
        this.setOperator('multiply', null);
        return true;
      }
      if (key === '/') {
        this.setOperator('divide', null);
        return true;
      }
      if (key === '%') {
        this.percent();
        return true;
      }
      if (key === 'Enter' || key === '=') {
        this.evaluate();
        return true;
      }
      if (key === 'Escape') {
        this.clear();
        return true;
      }
      if (key === 'Backspace') {
        this.backspace();
        return true;
      }
      return false;
    },

    /**
     * Reset calculator state
     */
    reset() {
      this.currentDisplay = '0';
      this.previousValue = null;
      this.operator = null;
      this.waitingForOperand = false;
      this.expression = '';
      this.justEvaluated = false;
      this.updateDisplay();
      this.clearOperatorHighlight();
    },

    /**
     * Clear (C)
     */
    clear() {
      this.reset();
    },

    /**
     * @param {string} digit
     * @param {boolean} isDecimal
     */
    inputDigit(digit, isDecimal) {
      if (this.currentDisplay === 'Error') {
        this.currentDisplay = digit;
        this.previousValue = null;
        this.operator = null;
        this.expression = '';
        this.justEvaluated = false;
        this.updateDisplay();
        return;
      }

      if (this.waitingForOperand) {
        this.currentDisplay = isDecimal ? '0.' : digit;
        this.waitingForOperand = false;
        this.justEvaluated = false;
      } else {
        if (isDecimal) {
          if (this.currentDisplay.includes('.')) return;
          this.currentDisplay += '.';
        } else {
          if (this.currentDisplay === '0') {
            this.currentDisplay = digit;
          } else if (this.currentDisplay.length < 15) {
            this.currentDisplay += digit;
          }
        }
      }
      this.updateDisplay();
    },

    /**
     * Backspace
     */
    backspace() {
      if (this.currentDisplay === 'Error') {
        this.clear();
        return;
      }
      if (this.waitingForOperand || this.justEvaluated) return;

      if (this.currentDisplay.length === 1 ||
          (this.currentDisplay.length === 2 && this.currentDisplay[0] === '-')) {
        this.currentDisplay = '0';
      } else {
        this.currentDisplay = this.currentDisplay.slice(0, -1);
      }
      this.updateDisplay();
    },

    /**
     * @param {string} op
     * @param {HTMLElement|null} btn
     */
    setOperator(op, btn) {
      if (this.currentDisplay === 'Error') {
        this.clear();
      }

      const current = parseFloat(this.currentDisplay);

      if (this.operator && !this.waitingForOperand) {
        // Chain operations: evaluate previous first
        const result = this.compute(this.previousValue, current, this.operator);
        if (result === 'Error') {
          this.currentDisplay = 'Error';
          this.previousValue = null;
          this.operator = null;
          this.expression = '';
          this.updateDisplay();
          return;
        }
        this.currentDisplay = this.formatResult(result);
        this.previousValue = parseFloat(this.currentDisplay);
      } else {
        this.previousValue = current;
      }

      this.operator = op;
      this.waitingForOperand = true;
      this.justEvaluated = false;

      // Update expression display
      const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };
      this.expression = this.currentDisplay + ' ' + opSymbols[op];
      this.updateDisplay();

      // Highlight active operator button
      this.clearOperatorHighlight();
      if (btn) {
        btn.classList.add('active');
      }
    },

    /**
     * Evaluate (=)
     */
    evaluate() {
      if (this.currentDisplay === 'Error') {
        this.reset();
        return;
      }
      if (!this.operator || this.previousValue === null) return;

      const current = parseFloat(this.currentDisplay);
      const opSymbols = { add: '+', subtract: '−', multiply: '×', divide: '÷' };
      this.expression = this.formatDisplay(this.previousValue) + ' ' + opSymbols[this.operator] + ' ' + this.formatDisplay(current) + ' =';

      const result = this.compute(this.previousValue, current, this.operator);

      this.clearOperatorHighlight();

      if (result === 'Error') {
        this.currentDisplay = 'Error';
      } else {
        this.currentDisplay = this.formatResult(result);
      }

      this.previousValue = null;
      this.operator = null;
      this.waitingForOperand = false;
      this.justEvaluated = true;
      this.updateDisplay();
    },

    /**
     * Negate (±)
     */
    negate() {
      if (this.currentDisplay === 'Error' || this.currentDisplay === '0') return;
      if (this.currentDisplay.startsWith('-')) {
        this.currentDisplay = this.currentDisplay.slice(1);
      } else {
        this.currentDisplay = '-' + this.currentDisplay;
      }
      this.updateDisplay();
    },

    /**
     * Percent (%) — divide current value by 100
     */
    percent() {
      if (this.currentDisplay === 'Error') return;
      const current = parseFloat(this.currentDisplay);
      this.currentDisplay = this.formatResult(current / 100);
      this.updateDisplay();
    },

    /**
     * @param {number} a
     * @param {number} b
     * @param {string} op
     * @returns {number|string}
     */
    compute(a, b, op) {
      switch (op) {
        case 'add': return a + b;
        case 'subtract': return a - b;
        case 'multiply': return a * b;
        case 'divide':
          if (b === 0) return 'Error';
          return a / b;
        default: return b;
      }
    },

    /**
     * @param {number} val
     * @returns {string}
     */
    formatResult(val) {
      if (!isFinite(val)) return 'Error';
      // Limit to 15 significant digits to avoid floating point noise
      const str = parseFloat(val.toPrecision(15)).toString();
      return str;
    },

    /**
     * @param {number} val
     * @returns {string}
     */
    formatDisplay(val) {
      return this.formatResult(val);
    },

    /**
     * Update the display elements
     */
    updateDisplay() {
      // Format display number: add commas for readability
      let displayStr = this.currentDisplay;
      if (displayStr !== 'Error') {
        // Don't format if it ends with a dot or is just "-"
        let intPart = displayStr;
        let decPart = '';
        if (displayStr.includes('.')) {
          const parts = displayStr.split('.');
          intPart = parts[0];
          decPart = '.' + parts[1];
        }
        // Add thousand separators to integer part
        const sign = intPart.startsWith('-') ? '-' : '';
        const absInt = intPart.replace(/^-/, '');
        const formatted = absInt.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        displayStr = sign + formatted + decPart;
      }

      this.resultEl.textContent = displayStr;
      this.expressionEl.textContent = this.expression;

      // Adjust font size for long numbers
      if (displayStr.length > 14) {
        this.resultEl.style.fontSize = '20px';
      } else if (displayStr.length > 10) {
        this.resultEl.style.fontSize = '24px';
      } else {
        this.resultEl.style.fontSize = '32px';
      }
    },

    clearOperatorHighlight() {
      this.buttonsContainer.querySelectorAll('.calc-btn.operator').forEach(btn => {
        btn.classList.remove('active');
      });
    }
  };

  // ===== Minesweeper Module =====
  const Minesweeper = {
    /** Difficulty presets */
    DIFFICULTIES: {
      beginner:     { rows: 9,  cols: 9,  mines: 10 },
      intermediate: { rows: 16, cols: 16, mines: 40 },
      expert:       { rows: 16, cols: 30, mines: 99 }
    },

    currentDifficulty: 'beginner',
    board: [],        // 2D array of cell objects
    rows: 0,
    cols: 0,
    totalMines: 0,
    flagsPlaced: 0,
    gameOver: false,
    gameWon: false,
    firstClick: true,
    timerValue: 0,
    timerInterval: null,

    // Current instance reference
    bodyEl: null,
    boardEl: null,
    counterEl: null,
    timerEl: null,
    faceBtn: null,

    /**
     * @param {HTMLElement} body
     */
    init(body) {
      body.id = 'minesweeper-window';
      body.innerHTML = `
        <div class="minesweeper-difficulty-bar">
          <button class="minesweeper-difficulty-btn" data-diff="beginner">Beginner</button>
          <button class="minesweeper-difficulty-btn" data-diff="intermediate">Intermediate</button>
          <button class="minesweeper-difficulty-btn" data-diff="expert">Expert</button>
        </div>
        <div class="minesweeper-header">
          <div class="minesweeper-counter">000</div>
          <button class="minesweeper-face-btn">😀</button>
          <div class="minesweeper-timer">000</div>
        </div>
        <div class="minesweeper-board-container"></div>
      `;

      this.bodyEl = body;
      this.diffButtons = body.querySelectorAll('.minesweeper-difficulty-btn');
      this.counterEl = body.querySelector('.minesweeper-counter');
      this.timerEl = body.querySelector('.minesweeper-timer');
      this.faceBtn = body.querySelector('.minesweeper-face-btn');
      this.boardEl = body.querySelector('.minesweeper-board-container');

      this._bindDifficultyButtons();
      this.faceBtn.addEventListener('click', () => this._restart());

      // Set initial difficulty
      this.currentDifficulty = 'beginner';
      // Re-highlight the beginner button after _bindDifficultyButtons sets it
      const initBtn = this.bodyEl.querySelector('.minesweeper-difficulty-btn[data-diff="beginner"]');
      if (initBtn) initBtn.classList.add('active');
      this._restart();
    },

    /**
     * Bind difficulty buttons.
     */
    _bindDifficultyButtons() {
      this.diffButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.diffButtons.forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.currentDifficulty = btn.dataset.diff;
          this._restart();
        });
      });
      // Highlight current difficulty
      const activeBtn = this.bodyEl.querySelector('.minesweeper-difficulty-btn[data-diff="' + this.currentDifficulty + '"]');
      if (activeBtn) activeBtn.classList.add('active');
    },

    /**
     * Restart the game with current difficulty.
     */
    _restart() {
      this._stopTimer();
      const config = this.DIFFICULTIES[this.currentDifficulty];
      this.rows = config.rows;
      this.cols = config.cols;
      this.totalMines = config.mines;
      this.flagsPlaced = 0;
      this.gameOver = false;
      this.gameWon = false;
      this.firstClick = true;
      this.timerValue = 0;

      this._updateCounter();
      this._updateTimer();
      this.faceBtn.textContent = '😀';

      // Create empty board
      this.board = [];
      for (let r = 0; r < this.rows; r++) {
        this.board[r] = [];
        for (let c = 0; c < this.cols; c++) {
          this.board[r][c] = {
            mine: false,
            revealed: false,
            flagged: false,
            adjacentMines: 0
          };
        }
      }

      this._renderBoard();
    },

    /**
     * Place mines after the first click, ensuring the clicked cell and neighbors are safe.
     * @param {number} clickRow
     * @param {number} clickCol
     */
    _placeMines(clickRow, clickCol) {
      const safeCells = new Set();
      // Mark clicked cell and neighbors as safe
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const nr = clickRow + dr;
          const nc = clickCol + dc;
          if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
            safeCells.add(nr * this.cols + nc);
          }
        }
      }

      // Place mines randomly, avoiding safe cells
      let minesPlaced = 0;
      while (minesPlaced < this.totalMines) {
        const r = Math.floor(Math.random() * this.rows);
        const c = Math.floor(Math.random() * this.cols);
        const idx = r * this.cols + c;
        if (!safeCells.has(idx) && !this.board[r][c].mine) {
          this.board[r][c].mine = true;
          minesPlaced++;
        }
      }

      // Calculate adjacency numbers
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (this.board[r][c].mine) continue;
          let count = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (dr === 0 && dc === 0) continue;
              const nr = r + dr;
              const nc = c + dc;
              if (nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) {
                if (this.board[nr][nc].mine) count++;
              }
            }
          }
          this.board[r][c].adjacentMines = count;
        }
      }

      this.firstClick = false;
    },

    /**
     * Render the board as HTML.
     */
    _renderBoard() {
      this.boardEl.innerHTML = '';

      for (let r = 0; r < this.rows; r++) {
        const rowEl = document.createElement('div');
        rowEl.className = 'minesweeper-row';

        for (let c = 0; c < this.cols; c++) {
          const cellEl = document.createElement('div');
          cellEl.className = 'minesweeper-cell';
          cellEl.dataset.row = r;
          cellEl.dataset.col = c;

          // Left click
          cellEl.addEventListener('click', (e) => {
            e.preventDefault();
            this._handleLeftClick(r, c);
          });

          // Right click (flag)
          cellEl.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this._handleRightClick(r, c);
          });

          rowEl.appendChild(cellEl);
        }

        this.boardEl.appendChild(rowEl);
      }
    },

    /**
     * Get the cell DOM element.
     * @param {number} r
     * @param {number} c
     * @returns {HTMLElement}
     */
    _getCellEl(r, c) {
      return this.bodyEl.querySelector('.minesweeper-cell[data-row="' + r + '"][data-col="' + c + '"]');
    },

    /**
     * Handle left-click on a cell.
     * @param {number} r
     * @param {number} c
     */
    _handleLeftClick(r, c) {
      if (this.gameOver || this.gameWon) return;
      const cell = this.board[r][c];
      if (cell.flagged || cell.revealed) return;

      // First click: place mines, start timer
      if (this.firstClick) {
        this._placeMines(r, c);
        this._startTimer();
      }

      // Hit a mine
      if (cell.mine) {
        this._loseGame(r, c);
        return;
      }

      // Reveal cell (with flood fill for zeros)
      this._revealCell(r, c);

      // Check win
      this._checkWin();
    },

    /**
     * Flood-fill reveal starting from (r, c).
     * @param {number} r
     * @param {number} c
     */
    _revealCell(r, c) {
      if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return;
      const cell = this.board[r][c];
      if (cell.revealed || cell.flagged || cell.mine) return;

      cell.revealed = true;
      const el = this._getCellEl(r, c);
      el.classList.add('revealed');

      if (cell.adjacentMines > 0) {
        el.textContent = cell.adjacentMines;
        el.dataset.number = cell.adjacentMines;
      } else {
        // Flood fill neighbors for zero cells
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            this._revealCell(r + dr, c + dc);
          }
        }
      }
    },

    /**
     * Handle right-click to toggle flag.
     * @param {number} r
     * @param {number} c
     */
    _handleRightClick(r, c) {
      if (this.gameOver || this.gameWon) return;
      const cell = this.board[r][c];
      if (cell.revealed) return;

      cell.flagged = !cell.flagged;
      const el = this._getCellEl(r, c);

      if (cell.flagged) {
        el.classList.add('flagged-cell');
        el.textContent = '🚩';
        this.flagsPlaced++;
      } else {
        el.classList.remove('flagged-cell');
        el.textContent = '';
        this.flagsPlaced--;
      }

      this._updateCounter();
    },

    /**
     * Handle losing the game.
     * @param {number} mineRow
     * @param {number} mineCol
     */
    _loseGame(mineRow, mineCol) {
      this.gameOver = true;
      this._stopTimer();
      this.faceBtn.textContent = '😵';

      // Mark the clicked mine as revealed
      this.board[mineRow][mineCol].revealed = true;

      // Reveal all mines on the board
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          const cell = this.board[r][c];
          const el = this._getCellEl(r, c);

          if (cell.mine && !cell.revealed) {
            if (r === mineRow && c === mineCol) {
              el.classList.add('revealed', 'mine-revealed');
            } else if (cell.flagged) {
              // Wrongly flagged
              el.classList.remove('flagged-cell');
              el.classList.add('revealed', 'mine-revealed-wrong');
            }
            if (!cell.flagged && !cell.revealed) {
              el.classList.add('revealed');
            }
            if (!el.classList.contains('mine-revealed-wrong')) {
              el.textContent = '💣';
            }
          } else if (cell.flagged && !cell.mine) {
            // Wrongly flagged on non-mine
            el.classList.remove('flagged-cell');
            el.classList.add('revealed', 'mine-revealed-wrong');
            el.textContent = '✖';
          }
        }
      }
    },

    /**
     * Check if the player has won.
     */
    _checkWin() {
      let unrevealedSafe = 0;
      for (let r = 0; r < this.rows; r++) {
        for (let c = 0; c < this.cols; c++) {
          if (!this.board[r][c].mine && !this.board[r][c].revealed) {
            unrevealedSafe++;
          }
        }
      }

      if (unrevealedSafe === 0) {
        this.gameWon = true;
        this._stopTimer();
        this.faceBtn.textContent = '😎';

        // Flag all remaining mines
        for (let r = 0; r < this.rows; r++) {
          for (let c = 0; c < this.cols; c++) {
            if (this.board[r][c].mine && !this.board[r][c].flagged) {
              const el = this._getCellEl(r, c);
              el.classList.add('flagged-cell');
              el.textContent = '🚩';
            }
          }
        }
        this.flagsPlaced = this.totalMines;
        this._updateCounter();
      }
    },

    /**
     * Update the mine counter display.
     */
    _updateCounter() {
      const remaining = this.totalMines - this.flagsPlaced;
      const clamped = Math.max(remaining, -99);
      // Format: sign + 2-digit number
      const absVal = Math.abs(clamped);
      const str = (clamped < 0 ? '-' : '') + String(absVal).padStart(2, '0');
      this.counterEl.textContent = str;
    },

    /**
     * Start the game timer.
     */
    _startTimer() {
      this.timerValue = 0;
      this._updateTimer();
      this.timerInterval = setInterval(() => {
        this.timerValue++;
        if (this.timerValue > 999) this.timerValue = 999;
        this._updateTimer();
      }, 1000);
    },

    /**
     * Stop the game timer.
     */
    _stopTimer() {
      if (this.timerInterval) {
        clearInterval(this.timerInterval);
        this.timerInterval = null;
      }
    },

    /**
     * Update the timer display.
     */
    _updateTimer() {
      this.timerEl.textContent = String(this.timerValue).padStart(3, '0');
    }
  };

  // ===== Spider Solitaire Module =====
  const Spider = {
    CARD_HEIGHT: 64,
    CARD_WIDTH: 52,
    CARD_OFFSET: 16, // vertical overlap between cards
    SUIT_SYMBOL: '\u2660', // Spade
    RANK_NAMES: ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'],

    // Game state
    columns: [],    // Array of 10 arrays, each containing card objects
    stock: [],      // Remaining stock pile
    completedRows: 0, // Completed K-A sequences
    score: 0,
    moves: 0,
    gameActive: false,
    gameOver: false,

    // DOM references
    bodyEl: null,
    boardEl: null,

    // Drag state
    dragSourceCol: -1,
    dragSourceIdx: -1,
    dragCards: [], // [{card, colIdx, cardIdx}] for each card being dragged
    dragEl: null,

    /**
     * Create a deck of 104 cards (two full decks, one suit).
     * @returns {{rank: number}[]}
     */
    _createDeck() {
      // Two full decks, one suit = 2 × 52 = 104 cards
      // Each deck contributes all 13 ranks, so we have 2 copies per rank
      // But we need 104, so: 8 copies of each rank (2 decks × 4 suits rendered as spades)
      const deck = [];
      for (let d = 0; d < 2; d++) {
        for (let s = 0; s < 4; s++) {
          for (let r = 1; r <= 13; r++) {
            deck.push({ rank: r });
          }
        }
      }
      return deck;
    },

    /**
     * Fisher-Yates shuffle.
     * @param {{rank: number}[]} arr
     */
    _shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },

    /**
     * Initialize the Spider Solitaire game.
     * @param {HTMLElement} body
     */
    init(body) {
      body.id = 'spider-window';
      body.innerHTML = `
        <div class="spider-top-bar">
          <div class="spider-score-info">
            <span>Moves: <span class="score-value" id="spider-moves">0</span></span>
            <span>Score: <span class="score-value" id="spider-score">500</span></span>
            <span>Completed: <span class="score-value" id="spider-completed">0</span>/8</span>
          </div>
          <button class="spider-new-game-btn" id="spider-new-game">New Game</button>
        </div>
        <div class="spider-board" id="spider-board"></div>
      `;

      this.bodyEl = body;
      this.boardEl = body.querySelector('#spider-board');
      this.movesEl = body.querySelector('#spider-moves');
      this.scoreEl = body.querySelector('#spider-score');
      this.completedEl = body.querySelector('#spider-completed');

      this._bindEvents();
      this.newGame();
    },

    /**
     * Bind button and board events.
     */
    _bindEvents() {
      // New Game button
      const newGameBtn = this.bodyEl.querySelector('#spider-new-game');
      newGameBtn.addEventListener('click', () => {
        this.newGame();
      });
    },

    /**
     * Start a new game.
     */
    newGame() {
      // Remove any win overlay
      const overlay = this.bodyEl.querySelector('.spider-win-overlay');
      if (overlay) overlay.remove();

      // Create and shuffle deck
      const deck = this._createDeck();
      this._shuffle(deck);

      // Deal initial layout: 4 columns of 6 + 6 columns of 5 = 10 columns
      // Columns 0-3: 6 cards each (4 face-up + 2 face-down)
      // Columns 4-9: 5 cards each (4 face-down + 1 face-up)
      this.columns = [];
      let cardIdx = 0;

      for (let col = 0; col < 10; col++) {
        const numCards = col < 4 ? 6 : 5;
        const colCards = [];
        for (let c = 0; c < numCards; c++) {
          const isFaceUp = c === numCards - 1; // only top card face-up
          colCards.push({
            card: deck[cardIdx++],
            faceUp: isFaceUp
          });
        }
        this.columns[col] = colCards;
      }

      // Remaining cards form the stock
      this.stock = [];
      while (cardIdx < 104) {
        this.stock.push(deck[cardIdx++]);
      }

      this.completedRows = 0;
      this.score = 500;
      this.moves = 0;
      this.gameActive = true;
      this.gameOver = false;

      this._updateScoreDisplay();
      this._renderBoard();
    },

    /**
     * Check if a card can be placed on top of a tableau card.
     * @param {number} rank - rank of card to place
     * @param {number} targetRank - rank of card it should go on
     * @returns {boolean}
     */
    _canPlaceOn(rank, targetRank) {
      return rank === targetRank - 1;
    },

    /**
     * Check if a complete K-A sequence exists at the bottom of a column.
     * @param {number} colIdx
     * @returns {boolean}
     */
    _hasCompletedSequence(colIdx) {
      const col = this.columns[colIdx];
      if (col.length < 13) return false;

      // Check if bottom 13 cards form a K-A descending sequence
      for (let i = 0; i < 13; i++) {
        const card = col[col.length - 13 + i];
        if (!card.faceUp) return false;
        if (card.card.rank !== 13 - i) return false;
      }
      return true;
    },

    /**
     * Remove a completed K-A sequence from a column.
     * @param {number} colIdx
     */
    _removeCompletedSequence(colIdx) {
      const col = this.columns[colIdx];
      if (col.length < 13) return;

      col.splice(col.length - 13, 13);
      this.completedRows++;
      this.score += 100;

      // If column is not empty, flip the new top card face-up
      if (col.length > 0) {
        const topCard = col[col.length - 1];
        if (!topCard.faceUp) {
          topCard.faceUp = true;
          this.score += 10;
        }
      }

      this._updateScoreDisplay();
      this._renderBoard();

      // Check for win
      if (this.completedRows >= 8) {
        this.gameActive = false;
        this.gameOver = true;
        this._showWinOverlay();
      }
    },

    /**
     * Show the win overlay.
     */
    _showWinOverlay() {
      const overlay = document.createElement('div');
      overlay.className = 'spider-win-overlay';
      overlay.innerHTML = `
        <div class="spider-win-message">
          <h2>🎉 You Win!</h2>
          <p>Moves: ${this.moves} | Score: ${this.score}</p>
          <button class="spider-new-game-btn" id="spider-play-again">Play Again</button>
        </div>
      `;
      this.bodyEl.appendChild(overlay);
      overlay.querySelector('#spider-play-again').addEventListener('click', () => {
        this.newGame();
      });
    },

    /**
     * Deal one card from the stock to each column.
     * Only allowed when no column is empty.
     */
    dealStock() {
      if (this.stock.length === 0) return;
      if (this.columns.some(col => col.length === 0)) return;

      for (let col = 0; col < 10; col++) {
        this.columns[col].push({
          card: this.stock.pop(),
          faceUp: true
        });
      }

      this._updateScoreDisplay();
      this._renderBoard();
    },

    /**
     * Try to move a sequence of cards from sourceCol to targetCol.
     * @param {number} sourceCol
     * @param {number} sourceIdx - index within the source column
     * @param {number} targetCol
     * @returns {boolean} whether the move was valid and executed
     */
    tryMove(sourceCol, sourceIdx, targetCol) {
      if (sourceCol === targetCol) return false;
      if (!this.gameActive || this.gameOver) return false;

      const sourceCards = this.columns[sourceCol].slice(sourceIdx);
      if (sourceCards.length === 0) return false;

      // Check that all moved cards are face-up and in descending order
      for (let i = 0; i < sourceCards.length; i++) {
        if (!sourceCards[i].faceUp) return false;
        if (i > 0) {
          if (sourceCards[i].card.rank !== sourceCards[i - 1].card.rank - 1) return false;
        }
      }

      // Check target column validity
      if (this.columns[targetCol].length === 0) {
        // Empty column: any card or sequence can be moved
      } else {
        const targetTop = this.columns[targetCol][this.columns[targetCol].length - 1];
        if (!targetTop.faceUp) return false;
        if (!this._canPlaceOn(sourceCards[0].card.rank, targetTop.card.rank)) return false;
      }

      // Execute move
      this.columns[targetCol].push(...sourceCards);
      this.columns[sourceCol].splice(sourceIdx);
      this.moves++;
      this.score = Math.max(0, this.score - 1);

      // Flip newly exposed card in source column
      if (this.columns[sourceCol].length > 0) {
        const exposed = this.columns[sourceCol][this.columns[sourceCol].length - 1];
        if (!exposed.faceUp) {
          exposed.faceUp = true;
          this.score += 10;
        }
      }

      this._updateScoreDisplay();
      this._renderBoard();

      // Check for completed sequences in both columns
      this._checkAllColumnsForCompletion();

      return true;
    },

    /**
     * Check all columns for completed K-A sequences.
     */
    _checkAllColumnsForCompletion() {
      let found = true;
      while (found) {
        found = false;
        for (let col = 0; col < 10; col++) {
          if (this._hasCompletedSequence(col)) {
            this._removeCompletedSequence(col);
            found = true;
            // Re-check all columns after removal (column indices may shift in render)
            break;
          }
        }
      }
    },

    /**
     * Update score display elements.
     */
    _updateScoreDisplay() {
      this.movesEl.textContent = this.moves;
      this.scoreEl.textContent = this.score;
      this.completedEl.textContent = this.completedRows;
    },

    /**
     * Render the entire board.
     */
    _renderBoard() {
      this.boardEl.innerHTML = '';

      // Create 10 column containers
      for (let col = 0; col < 10; col++) {
        const colEl = document.createElement('div');
        colEl.className = 'spider-column';
        colEl.dataset.col = col;

        // Show placeholder if column is empty
        if (this.columns[col].length === 0) {
          const placeholder = document.createElement('div');
          placeholder.className = 'spider-column-placeholder';
          colEl.appendChild(placeholder);
        }

        // Render cards in column
        const colData = this.columns[col];
        for (let idx = 0; idx < colData.length; idx++) {
          const cardData = colData[idx];
          const cardEl = this._createCardElement(cardData.card, cardData.faceUp, col, idx);
          cardEl.style.top = (idx * Spider.CARD_OFFSET) + 'px';
          colEl.appendChild(cardEl);
        }

        this.boardEl.appendChild(colEl);
      }

      // Stock pile
      this._renderStock();

      // Completed row indicators
      this._renderCompletedSlots();
    },

    /**
     * Render the stock pile area.
     */
    _renderStock() {
      // Remove existing stock element
      const existingStock = this.bodyEl.querySelector('.spider-stock-area');
      if (existingStock) existingStock.remove();

      if (this.stock.length === 0) return;

      const stockEl = document.createElement('div');
      stockEl.className = 'spider-stock-area';
      stockEl.innerHTML = `
        <div class="spider-stock-pile has-cards"></div>
        <span class="spider-stock-label">${Math.ceil(this.stock.length / 10)}</span>
      `;
      stockEl.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dealStock();
      });
      this.bodyEl.appendChild(stockEl);
    },

    /**
     * Render completed row slots.
     */
    _renderCompletedSlots() {
      // Remove existing
      const existing = this.bodyEl.querySelector('.spider-completion-row');
      if (existing) existing.remove();

      const rowEl = document.createElement('div');
      rowEl.className = 'spider-completion-row';

      for (let i = 0; i < 8; i++) {
        const slot = document.createElement('div');
        if (i < this.completedRows) {
          slot.className = 'spider-completion-slot filled';
          slot.textContent = this.SUIT_SYMBOL;
        } else {
          slot.className = 'spider-completion-slot';
        }
        rowEl.appendChild(slot);
      }

      this.bodyEl.appendChild(rowEl);
    },

    /**
     * Create a card DOM element.
     * @param {{rank: number}} card
     * @param {boolean} faceUp
     * @param {number} col
     * @param {number} idx
     * @returns {HTMLElement}
     */
    _createCardElement(card, faceUp, col, idx) {
      const el = document.createElement('div');
      el.className = 'spider-card ' + (faceUp ? 'face-up' : 'face-down');
      el.dataset.col = col;
      el.dataset.idx = idx;

      if (faceUp) {
        const rankEl = document.createElement('span');
        rankEl.className = 'card-rank';
        rankEl.textContent = this.RANK_NAMES[card.rank];

        const suitEl = document.createElement('span');
        suitEl.className = 'card-suit';
        suitEl.textContent = this.SUIT_SYMBOL;

        const rankBrEl = document.createElement('span');
        rankBrEl.className = 'card-rank-br';
        rankBrEl.textContent = this.RANK_NAMES[card.rank];

        el.appendChild(rankEl);
        el.appendChild(suitEl);
        el.appendChild(rankBrEl);
      }

      // Bind drag events
      if (faceUp) {
        el.addEventListener('mousedown', (e) => this._onCardMouseDown(e, col, idx));
      }

      return el;
    },

    /**
     * Handle mouse down on a card for drag.
     * @param {MouseEvent} e
     * @param {number} col
     * @param {number} idx
     */
    _onCardMouseDown(e, col, idx) {
      if (!this.gameActive || this.gameOver) return;
      if (e.button !== 0) return; // only left click
      e.preventDefault();

      const colData = this.columns[col];
      // Only drag face-up cards
      if (!colData[idx].faceUp) return;

      // Check that all cards from idx to end are face-up and in sequence
      for (let i = idx; i < colData.length; i++) {
        if (!colData[i].faceUp) return;
        if (i > idx && colData[i].card.rank !== colData[i - 1].card.rank - 1) return;
      }

      this.dragSourceCol = col;
      this.dragSourceIdx = idx;

      // Build drag cards info
      this.dragCards = colData.slice(idx).map((cd, i) => ({
        card: cd.card,
        colIdx: i,
        cardIdx: idx + i
      }));

      // Create floating drag ghost
      const sourceColEl = this.boardEl.children[col];
      const sourceCardEl = sourceColEl.querySelector('.spider-card[data-idx="' + idx + '"]');
      if (!sourceCardEl) return;

      const rect = sourceCardEl.getBoundingClientRect();
      this.dragEl = document.createElement('div');
      this.dragEl.style.position = 'fixed';
      this.dragEl.style.left = rect.left + 'px';
      this.dragEl.style.top = rect.top + 'px';
      this.dragEl.style.width = Spider.CARD_WIDTH + 'px';
      this.dragEl.style.height = (this.dragCards.length - 1) * Spider.CARD_OFFSET + Spider.CARD_HEIGHT + 'px';
      this.dragEl.style.pointerEvents = 'none';
      this.dragEl.style.zIndex = '10000';

      // Create ghost card elements
      for (let i = 0; i < this.dragCards.length; i++) {
        const cd = this.dragCards[i];
        const ghostCard = this._createCardElement(cd.card, true, -1, -1);
        ghostCard.className = 'spider-card face-up dragging';
        ghostCard.style.position = 'absolute';
        ghostCard.style.top = (i * Spider.CARD_OFFSET) + 'px';
        ghostCard.style.left = '0px';
        ghostCard.style.width = Spider.CARD_WIDTH + 'px';
        ghostCard.style.height = Spider.CARD_HEIGHT + 'px';
        this.dragEl.appendChild(ghostCard);
      }

      document.body.appendChild(this.dragEl);

      // Hide original cards during drag
      for (let i = idx; i < colData.length; i++) {
        const origEl = sourceColEl.querySelector('.spider-card[data-idx="' + i + '"]');
        if (origEl) origEl.style.visibility = 'hidden';
      }

      // Bind move/up handlers
      const onMove = (ev) => {
        if (!this.dragEl) return;
        this.dragEl.style.left = (ev.clientX - Spider.CARD_WIDTH / 2) + 'px';
        this.dragEl.style.top = (ev.clientY - Spider.CARD_HEIGHT / 2) + 'px';

        // Highlight target column
        this._highlightDropTarget(ev.clientX, ev.clientY);
      };

      const onUp = (ev) => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this._onCardMouseUp(ev);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },

    /**
     * Highlight the target column for drop.
     * @param {number} x
     * @param {number} y
     */
    _highlightDropTarget(x, y) {
      // Remove previous highlights
      this.boardEl.querySelectorAll('.spider-column').forEach((colEl) => {
        colEl.style.outline = '';
      });

      const dropCol = this._getColumnAtPosition(x, y);
      if (dropCol >= 0 && dropCol !== this.dragSourceCol) {
        this.boardEl.children[dropCol].style.outline = '2px solid rgba(255,255,0,0.5)';
        this.boardEl.children[dropCol].style.borderRadius = '6px';
      }
    },

    /**
     * Handle mouse up after drag.
     * @param {MouseEvent} e
     */
    _onCardMouseUp(e) {
      // Remove highlight
      this.boardEl.querySelectorAll('.spider-column').forEach((colEl) => {
        colEl.style.outline = '';
      });

      // Determine drop target
      const dropCol = this._getColumnAtPosition(e.clientX, e.clientY);

      if (dropCol >= 0 && dropCol !== this.dragSourceCol) {
        const success = this.tryMove(this.dragSourceCol, this.dragSourceIdx, dropCol);
        if (!success) {
          // Snap back: re-render to restore original state
          this._renderBoard();
        }
      } else {
        // Snap back: re-render
        this._renderBoard();
      }

      // Clean up drag elements
      if (this.dragEl) {
        this.dragEl.remove();
        this.dragEl = null;
      }

      this.dragSourceCol = -1;
      this.dragSourceIdx = -1;
      this.dragCards = [];
    },

    /**
     * Find which column a point is over.
     * @param {number} x
     * @param {number} y
     * @returns {number} column index, or -1
     */
    _getColumnAtPosition(x, y) {
      const columns = this.boardEl.querySelectorAll('.spider-column');
      for (let i = 0; i < columns.length; i++) {
        const rect = columns[i].getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          return i;
        }
      }
      return -1;
    }
  };

  // ===== App Launchers (placeholder content for ticket 1) =====

  Desktop._openNotepad = function () {
    WindowRegistry.register('notepad', 'Notepad — Untitled', 550, 400, (body) => {
      body.innerHTML = '<div class="placeholder">Notepad — Double-click the desktop icon to open. Full implementation in a later ticket.</div>';
    });
  };

  Desktop._openCalculator = function () {
    WindowRegistry.register('calculator', 'Calculator', 320, 440, (body) => {
      Calculator.init(body);
    });
  };

  Desktop._openMinesweeper = function () {
    const config = Minesweeper.DIFFICULTIES[Minesweeper.currentDifficulty || 'beginner'];
    // Calculate window size based on board dimensions
    const winWidth = Math.max(400, config.cols * 28 + 30);
    const winHeight = Math.max(350, config.rows * 28 + 160);
    WindowRegistry.register('minesweeper', 'Minesweeper', winWidth, winHeight, (body) => {
      Minesweeper.init(body);
    });
  };

  Desktop._openSpider = function () {
    WindowRegistry.register('spider', 'Spider Solitaire', 820, 600, (body) => {
      Spider.init(body);
    });
  };

  // ===== Initialize =====
  document.addEventListener('DOMContentLoaded', () => {
    Desktop.init();

    // Restore wallpaper from localStorage
    try {
      const saved = localStorage.getItem('browser-os-wallpaper');
      if (saved !== null) {
        Desktop.setWallpaper(parseInt(saved, 10) || 0);
      }
    } catch (e) { /* ignore */ }
  });

  // ===== Notepad Module =====
  const Notepad = {
    STORAGE_KEY: 'browser-os-notepad-documents',
    currentDocName: null,
    currentDocContent: '',
    docList: [],

    /**
     * Load saved documents from localStorage.
     * @returns {{name: string, content: string}[]}
     */
    loadDocuments() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        if (!raw) return [];
        const docs = JSON.parse(raw);
        if (!Array.isArray(docs)) return [];
        return docs;
      } catch (e) {
        return [];
      }
    },

    /**
     * Save documents list to localStorage.
     */
    saveDocuments() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.docList));
      } catch (e) { /* quota exceeded etc. */ }
    },

    /**
     * @param {HTMLElement} body
     */
    init(body) {
      body.id = 'notepad-window';
      body.innerHTML = `
        <div class="notepad-sidebar">
          <div class="notepad-sidebar-header">
            <span>Documents</span>
            <button class="notepad-sidebar-btn" id="notepad-new-doc" title="New document">+</button>
          </div>
          <div class="notepad-document-list" id="notepad-doc-list"></div>
        </div>
        <div class="notepad-edit-area">
          <div class="notepad-toolbar">
            <button class="notepad-toolbar-btn" id="notepad-save-btn">Save</button>
            <button class="notepad-toolbar-btn danger" id="notepad-delete-btn">Delete</button>
          </div>
          <textarea class="notepad-textarea" id="notepad-textarea" placeholder="Start typing..."></textarea>
        </div>
      `;

      this.docList = this.loadDocuments();
      this.docListEl = body.querySelector('#notepad-doc-list');
      this.textarea = body.querySelector('#notepad-textarea');

      this.renderDocList();

      // New document button
      body.querySelector('#notepad-new-doc').addEventListener('click', (e) => {
        e.stopPropagation();
        this.createNewDocument();
      });

      // Save button
      body.querySelector('#notepad-save-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.saveCurrentDocument();
      });

      // Delete button
      body.querySelector('#notepad-delete-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deleteCurrentDocument();
      });

      // Textarea input handler
      this.textarea.addEventListener('input', () => {
        this.currentDocContent = this.textarea.value;
      });

      // Open the first document if available
      if (this.docList.length > 0) {
        this.openDocument(this.docList[0].name);
      }
    },

    /**
     * Render the document list sidebar.
     */
    renderDocList() {
      this.docListEl.innerHTML = '';
      this.docList.forEach((doc) => {
        const item = document.createElement('div');
        item.className = 'notepad-document-item' + (doc.name === this.currentDocName ? ' active' : '');
        item.textContent = doc.name;
        item.addEventListener('click', () => {
          this.openDocument(doc.name);
        });
        this.docListEl.appendChild(item);
      });
    },

    /**
     * Generate a unique "Untitled" name.
     * @returns {string}
     */
    generateUntitledName() {
      let n = 1;
      let name = 'Untitled';
      // Check if "Untitled" already exists
      const hasUntitled = this.docList.some((d) => d.name === 'Untitled');
      if (hasUntitled) {
        name = 'Untitled ' + n;
      }
      // Keep incrementing until unique
      while (this.docList.some((d) => d.name === name)) {
        n++;
        name = 'Untitled ' + n;
      }
      return name;
    },

    /**
     * Create a new empty document.
     */
    createNewDocument() {
      const name = this.generateUntitledName();
      this.docList.push({ name: name, content: '' });
      this.saveDocuments();
      this.renderDocList();
      this.openDocument(name);
      WindowRegistry.focus('notepad');
      WindowRegistry.windows.get('notepad').title = 'Notepad — ' + name;
    },

    /**
     * Open a document by name.
     * @param {string} name
     */
    openDocument(name) {
      // If there's a current document, ensure it's saved to the list
      if (this.currentDocName) {
        const existing = this.docList.find((d) => d.name === this.currentDocName);
        if (existing) {
          existing.content = this.textarea.value;
        }
      }

      const doc = this.docList.find((d) => d.name === name);
      if (!doc) return;

      this.currentDocName = doc.name;
      this.currentDocContent = doc.content;
      this.textarea.value = doc.content;

      // Update window title
      const record = WindowRegistry.windows.get('notepad');
      if (record) {
        record.title = 'Notepad — ' + name;
        WindowRegistry.focus('notepad');
        Taskbar.sync();
      }

      // Update active state in sidebar
      this.renderDocList();
    },

    /**
     * Save the current document.
     */
    saveCurrentDocument() {
      if (!this.currentDocName) return;

      const content = this.textarea.value;
      const existing = this.docList.find((d) => d.name === this.currentDocName);
      if (existing) {
        existing.content = content;
      } else {
        this.docList.push({ name: this.currentDocName, content: content });
      }
      this.saveDocuments();
    },

    /**
     * Delete the current document after confirmation.
     */
    deleteCurrentDocument() {
      if (!this.currentDocName) return;

      if (!confirm('Delete "' + this.currentDocName + '"?')) return;

      this.docList = this.docList.filter((d) => d.name !== this.currentDocName);
      this.saveDocuments();

      this.currentDocName = null;
      this.currentDocContent = '';
      this.textarea.value = '';

      // Update window title
      const record = WindowRegistry.windows.get('notepad');
      if (record) {
        record.title = 'Notepad — Untitled';
        WindowRegistry.focus('notepad');
        Taskbar.sync();
      }

      this.renderDocList();
    }
  };

  // ===== App Launchers =====

  Desktop._openNotepad = function () {
    WindowRegistry.register('notepad', 'Notepad — Untitled', 650, 420, (body) => {
      Notepad.init(body);
    });
  };

  // Expose for testing
  window.WindowRegistry = WindowRegistry;
  window.Taskbar = Taskbar;
  window.Desktop = Desktop;
  window.Calculator = Calculator;
  window.Notepad = Notepad;
  window.Minesweeper = Minesweeper;
  window.Spider = Spider;
})();
