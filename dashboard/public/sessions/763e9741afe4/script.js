/* ============================================
   Browser OS — Script
   Ticket 1: Desktop Shell — Window Manager & Taskbar
   ============================================ */

(function () {
  "use strict";

  // ============================================================
  // App registry — maps app names to their window creation handlers
  // ============================================================
  const APP_CONFIG = {
    notepad: { title: "Notepad", width: 480, height: 360 },
    calculator: { title: "Calculator", width: 280, height: 400 },
    minesweeper: { title: "Minesweeper", width: 400, height: 440 },
    spidersolitaire: { title: "Spider Solitaire", width: 720, height: 500 },
  };

  // ============================================================
  // Window Manager
  // Manages window lifecycle: create, focus, minimize, close, z-order
  // ============================================================
  const WindowManager = {
    windows: new Map(),       // appId -> window element
    zIndex: 100,              // base z-index for new windows
    maxZ: 100,                // highest z-index currently in use
    dragState: null,          // current drag info
    resizeState: null,        // current resize info
    dragOffsetX: 0,
    dragOffsetY: 0,

    /**
     * Create a new window for an app.
     * Returns the window element.
     */
    createWindow(appId) {
      const config = APP_CONFIG[appId];
      if (!config) return null;

      // Check if window already exists (single instance per app)
      if (this.windows.has(appId)) {
        const existing = this.windows.get(appId);
        if (existing.classList.contains("minimized")) {
          existing.classList.remove("minimized");
        }
        this.focusWindow(appId);
        return existing;
      }

      // Clone the window template
      const template = document.getElementById("window-template");
      const clone = template.content.cloneNode(true);
      const win = clone.querySelector(".window");

      // Set app id and title
      win.dataset.app = appId;
      win.querySelector(".window-title").textContent = config.title;

      // Set initial size and position
      this.setSize(win, config.width, config.height);
      this.setPosition(win, config.width, config.height);

      // Add placeholder content
      const content = win.querySelector(".window-content");
      content.classList.add("placeholder");
      content.textContent = "🚧 " + config.title + " — placeholder";

      // Add resize handle
      const resizer = document.createElement("div");
      resizer.classList.add("window-resizer");
      win.appendChild(resizer);

      // Add to DOM
      document.getElementById("desktop").appendChild(win);

      // Add drag listeners to the titlebar
      const titlebar = win.querySelector(".window-titlebar");
      titlebar.addEventListener("mousedown", (e) => this.startDrag(e, win));

      // Add resize listener to the resizer
      resizer.addEventListener("mousedown", (e) => this.startResize(e, win));

      // Add click listener to focus window
      win.addEventListener("mousedown", (e) => {
        if (!e.target.classList.contains("window-resizer")) {
          this.focusWindow(appId);
        }
      });

      // Close button handler
      const closeBtn = win.querySelector(".window-close");
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeWindow(appId);
      });

      this.windows.set(appId, win);
      this.focusWindow(appId);
      Taskbar.add(appId, config.title);
      return win;
    },

    /**
     * Focus a window (raise it, show it, highlight taskbar button).
     */
    focusWindow(appId) {
      // Unfocus all other windows
      this.windows.forEach((win, id) => {
        if (id !== appId) {
          win.classList.remove("focused");
          win.style.zIndex = parseInt(win.style.zIndex) || this.zIndex;
          Taskbar.setActive(id, false);
        }
      });

      const win = this.windows.get(appId);
      if (!win || win.classList.contains("minimized")) return;

      // Raise z-index
      this.maxZ = Math.max(this.maxZ, this.zIndex) + 1;
      this.zIndex = this.maxZ;
      win.style.zIndex = this.zIndex;
      win.classList.add("focused");

      // Highlight taskbar button
      Taskbar.setActive(appId, true);
    },

    /**
     * Close a window and remove it from the manager.
     */
    closeWindow(appId) {
      const win = this.windows.get(appId);
      if (!win) return;

      win.remove();
      this.windows.delete(appId);

      // Remove taskbar button
      Taskbar.remove(appId);

      // Focus the next highest window if any
      if (this.windows.size > 0) {
        const ids = [...this.windows.keys()];
        const topId = ids.reduce((a, b) =>
          parseInt(this.windows.get(a).style.zIndex) >
          parseInt(this.windows.get(b).style.zIndex)
            ? a
            : b
        );
        this.focusWindow(topId);
      }
    },

    /**
     * Minimize a window.
     */
    minimizeWindow(appId) {
      const win = this.windows.get(appId);
      if (!win) return;
      win.classList.add("minimized");
      win.classList.remove("focused");
      Taskbar.setActive(appId, false);
    },

    /**
     * Restore a minimized window.
     */
    restoreWindow(appId) {
      const win = this.windows.get(appId);
      if (!win) return;
      win.classList.remove("minimized");
      this.focusWindow(appId);
    },

    /**
     * Set window size.
     */
    setSize(win, width, height) {
      win.style.width = width + "px";
      win.style.height = height + "px";
    },

    /**
     * Set window position, constrained to the viewport.
     */
    setPosition(win, width, height) {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight - 40; // taskbar height

      // Center the window, but offset slightly based on existing windows
      const offset = (this.windows.size % 4) * 30;
      const x = Math.max(16, Math.min(viewportWidth - width - 16, (viewportWidth - width) / 2 + offset));
      const y = Math.max(16, Math.min(viewportHeight - height - 16, (viewportHeight - height) / 2 + offset));

      win.style.left = x + "px";
      win.style.top = y + "px";
    },

    // ============================================================
    // Drag handling
    // ============================================================
    startDrag(e, win) {
      if (e.target.classList.contains("window-close")) return;

      e.preventDefault();
      e.stopPropagation();

      const rect = win.getBoundingClientRect();
      this.dragState = { win, startX: e.clientX, startY: e.clientY };
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      win.classList.add("dragging");

      document.addEventListener("mousemove", this.onDrag);
      document.addEventListener("mouseup", this.onDragEnd);
    },

    onDrag: function (e) {
      if (!WindowManager.dragState) return;
      const { win, startX, startY } = WindowManager.dragState;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      let newX = win.offsetLeft + dx;
      let newY = win.offsetTop + dy;

      // Constrain to viewport
      const winWidth = win.offsetWidth;
      const winHeight = win.offsetHeight;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      newX = Math.max(0, Math.min(viewportWidth - winWidth, newX));
      newY = Math.max(0, Math.min(viewportHeight - winHeight, newY));

      win.style.left = newX + "px";
      win.style.top = newY + "px";
    },

    onDragEnd: function () {
      const { win } = WindowManager.dragState || {};
      if (win) {
        win.classList.remove("dragging");
      }
      WindowManager.dragState = null;
      document.removeEventListener("mousemove", WindowManager.onDrag);
      document.removeEventListener("mouseup", WindowManager.onDragEnd);
    },

    // ============================================================
    // Resize handling
    // ============================================================
    startResize(e, win) {
      e.preventDefault();
      e.stopPropagation();

      const rect = win.getBoundingClientRect();
      WindowManager.resizeState = { win, startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };
      win.classList.add("resizing");

      document.addEventListener("mousemove", WindowManager.onResize);
      document.addEventListener("mouseup", WindowManager.onResizeEnd);
    },

    onResize: function (e) {
      if (!WindowManager.resizeState) return;
      const { win, startX, startY, startW, startH } = WindowManager.resizeState;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      const newWidth = Math.max(200, startW + dx);
      const newHeight = Math.max(150, startH + dy);

      win.style.width = newWidth + "px";
      win.style.height = newHeight + "px";
    },

    onResizeEnd: function () {
      const { win } = WindowManager.resizeState || {};
      if (win) {
        win.classList.remove("resizing");
      }
      WindowManager.resizeState = null;
      document.removeEventListener("mousemove", WindowManager.onResize);
      document.removeEventListener("mouseup", WindowManager.onResizeEnd);
    },
  };

  // ============================================================
  // Taskbar
  // Manages taskbar buttons for open windows
  // ============================================================
  const Taskbar = {
    buttons: new Map(),       // appId -> button element

    /**
     * Add a button for an open window.
     */
    add(appId, title) {
      // Check if button already exists
      if (this.buttons.has(appId)) {
        const btn = this.buttons.get(appId);
        btn.classList.remove("minimized");
        btn.classList.add("active");
        return;
      }

      const btn = document.createElement("button");
      btn.classList.add("taskbar-button", "active");
      btn.dataset.app = appId;
      btn.textContent = title;
      btn.addEventListener("click", () => this.onClick(appId));
      btn.addEventListener("dblclick", (e) => {
        // Double-click to minimize
        e.preventDefault();
        e.stopPropagation();
        this.onMinimize(appId);
      });

      document.getElementById("taskbar-left").appendChild(btn);
      this.buttons.set(appId, btn);
    },

    /**
     * Remove a taskbar button.
     */
    remove(appId) {
      const btn = this.buttons.get(appId);
      if (btn) {
        btn.remove();
        this.buttons.delete(appId);
      }
    },

    /**
     * Set the active state of a taskbar button.
     */
    setActive(appId, isActive) {
      const btn = this.buttons.get(appId);
      if (!btn) return;

      if (isActive) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    },

    /**
     * Handle click on a taskbar button.
     */
    onClick(appId) {
      const win = WindowManager.windows.get(appId);
      if (!win) return;

      if (win.classList.contains("minimized")) {
        WindowManager.restoreWindow(appId);
      } else if (win.classList.contains("focused")) {
        // Minimize if already focused
        WindowManager.minimizeWindow(appId);
      } else {
        WindowManager.focusWindow(appId);
      }
    },

    /**
     * Handle double-click on a taskbar button (minimize).
     */
    onMinimize(appId) {
      WindowManager.minimizeWindow(appId);
    },
  };

  // ============================================================
  // Clock
  // Updates the taskbar clock display
  // ============================================================
  const Clock = {
    element: null,

    init() {
      this.element = document.getElementById("taskbar-clock");
      this.update();
      setInterval(() => this.update(), 1000);
    },

    update() {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");
      this.element.textContent = hours + ":" + minutes;
    },
  };

  // ============================================================
  // Desktop
  // Handles desktop icon double-click events
  // ============================================================
  const Desktop = {
    init() {
      // Attach double-click listeners to desktop icons
      document.querySelectorAll(".desktop-icon").forEach((icon) => {
        icon.addEventListener("dblclick", (e) => {
          e.preventDefault();
          const appId = icon.dataset.app;
          WindowManager.createWindow(appId);
        });
      });
    },
  };

  // ============================================================
  // Initialization
  // ============================================================
  document.addEventListener("DOMContentLoaded", () => {
    Clock.init();
    Desktop.init();
  });

  // Expose for testing
  window.__WindowManager = WindowManager;
  window.__Taskbar = Taskbar;
  window.__Clock = Clock;
  window.__APP_CONFIG = APP_CONFIG;

})();
