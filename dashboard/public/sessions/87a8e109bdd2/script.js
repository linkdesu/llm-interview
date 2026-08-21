/* ============================================================
   Browser OS — Desktop shell (Ticket 1)
   Window manager + taskbar + desktop icons.
   Apps open as placeholder windows at this stage.
   ============================================================ */

(function () {
  "use strict";

  /* ---- App registry --------------------------------------------------
     Each app has a unique id, display name, icon glyph, accent color,
     and a default window size. Single instance per app is enforced by
     the window manager. */
  var APPS = {
    notepad:     { name: "Notepad",           glyph: "📝", color: "#4a6fff", w: 520, h: 400 },
    calculator:  { name: "Calculator",        glyph: "🧮", color: "#34c759", w: 300, h: 440 },
    minesweeper: { name: "Minesweeper",       glyph: "💣", color: "#0a84ff", w: 340, h: 400 },
    spider:      { name: "Spider Solitaire",  glyph: "🕷️", color: "#af52de", w: 720, h: 480 }
  };

  /* ---- State --------------------------------------------------------- */
  var windows = {};   // id -> window model { id, appId, el, taskbarBtn, elMin, elMax, elClose, minimized, zTop }
  var zCounter = 100; // starts high so windows raise above desktop chrome
  var activeWindowId = null;

  // DOM references
  var desktopEl   = document.getElementById("desktop");
  var iconsEl     = document.getElementById("icons");
  var windowsEl   = document.getElementById("windows");
  var taskbarApps = document.getElementById("taskbar-apps");
  var clockEl     = document.getElementById("clock");
  var menuEl      = document.getElementById("desktop-menu");

  /* ============================================================
     Desktop icons
     ============================================================ */
  function buildDesktopIcons() {
    Object.keys(APPS).forEach(function (appId) {
      var app = APPS[appId];
      var icon = document.createElement("div");
      icon.className = "desktop-icon";
      icon.dataset.app = appId;
      icon.innerHTML =
        '<div class="icon-glyph" style="background:' + app.color + '">' + app.glyph + "</div>" +
        '<div class="icon-label">' + app.name + "</div>";

      // Double-click opens the app window.
      icon.addEventListener("dblclick", function () {
        openApp(appId);
      });

      iconsEl.appendChild(icon);
    });
  }

  /* ============================================================
     Window manager
     ============================================================ */

  /**
   * Open an app. If an instance already exists it is focused (and restored
   * from minimized). Otherwise a new window is created. Single instance
   * per app.
   */
  function openApp(appId) {
    var existing = windows[appId];
    if (existing) {
      if (existing.minimized) {
        existing.minimized = false;
        existing.el.style.display = "flex";
      }
      focusWindow(appId);
      return;
    }

    var app = APPS[appId];
    var model = createWindow(app);
    windows[appId] = model;

    focusWindow(appId);
    renderTaskbarButton(model);
  }

  /**
   * Create a window element and its backing model. Positions windows in a
   * descending staircase so newly opened windows are visible.
   */
  function createWindow(app) {
    var win = document.createElement("div");
    win.className = "window";
    win.dataset.app = appId;

    // Cascade placement, constrained to viewport (leave room for taskbar).
    var openCount = Object.keys(windows).length;
    var x = 60 + (openCount * 28);
    var y = 50 + (openCount * 28);
    var maxLeft = Math.max(0, window.innerWidth - app.w - 4);
    var maxTop = Math.max(0, window.innerHeight - 48 - app.h - 4);
    win.style.left = Math.min(x, maxLeft) + "px";
    win.style.top = Math.min(y, maxTop) + "px";
    win.style.width = app.w + "px";
    win.style.height = app.h + "px";
    win.style.zIndex = ++zCounter;

    win.innerHTML =
      '<div class="title-bar">' +
        '<div class="app-icon-small" style="background:' + app.color + '">' + app.glyph + "</div>" +
        '<div class="app-title">' + app.name + "</div>" +
        '<div class="window-controls">' +
          '<button class="win-btn win-min" title="Minimize">–</button>' +
          '<button class="win-btn win-max" title="Maximize">▢</button>' +
          '<button class="win-btn close" title="Close">×</button>' +
        "</div>" +
      "</div>" +
      '<div class="window-body">' +
        renderPlaceholder(app) +
      "</div>" +
      '<div class="resize-handle"></div>';

    windowsEl.appendChild(win);

    var model = {
      id: appId,
      appId: appId,
      el: win,
      app: app,
      minimized: false,
      maximized: false,
      prevRect: null // stores geometry before maximize
    };

    // Wire up interactions.
    setupTitleBarDrag(win, model);
    setupResize(win, model);
    win.addEventListener("mousedown", function () { focusWindow(appId); });
    win.querySelector(".win-close").addEventListener("click", onWindowClose);
    win.querySelector(".win-min").addEventListener("click", onWindowMinimize);
    win.querySelector(".win-max").addEventListener("click", onWindowToggleMaximize);

    return model;
  }

  function renderPlaceholder(app) {
    return (
      '<div class="placeholder">' +
        '<div class="ph-glyph">' + app.glyph + "</div>" +
        '<div class="ph-title">' + app.name + " <em>(placeholder)</em></div>" +
        '<div class="ph-sub">App content loads in a later ticket.</div>' +
      "</div>"
    );
  }

  /* ---- Window focus / z-order --------------------------------------- */
  function focusWindow(appId) {
    var model = windows[appId];
    if (!model) return;

    if (model.minimized) {
      model.minimized = false;
      model.el.style.display = "flex";
    }

    // Raise above other windows.
    model.el.style.zIndex = ++zCounter;
    zCounter = Math.min(zCounter, 100000);

    // Clear focused state from all windows.
    Object.keys(windows).forEach(function (id) {
      windows[id].el.classList.remove("focused");
    });
    model.el.classList.add("focused");
    activeWindowId = appId;

    // Update taskbar active state.
    Object.keys(windows).forEach(function (id) {
      var btn = windows[id].taskbarBtn;
      if (btn) btn.classList.toggle("active", id === appId);
    });
  }

  /* ---- Window controls ---------------------------------------------- */
  function onWindowClose(e) {
    e.stopPropagation();
    closeWindow(modelFor(e.currentTarget));
  }

  function onWindowMinimize(e) {
    e.stopPropagation();
    var model = modelFor(e.currentTarget);
    model.minimized = true;
    model.el.style.display = "none";
    if (activeWindowId === model.appId) {
      activeWindowId = null;
      clearActiveTaskbar();
    }
  }

  function onWindowToggleMaximize(e) {
    e.stopPropagation();
    var model = modelFor(e.currentTarget);
    toggleMaximize(model);
  }

  function closeWindow(model) {
    var appId = model.appId;
    model.el.remove();
    if (windows[appId] === model) {
      delete windows[appId];
    }
    if (model.taskbarBtn) {
      model.taskbarBtn.remove();
    }
    if (activeWindowId === appId) {
      activeWindowId = null;
      // Focus the topmost remaining window.
      var top = null;
      Object.keys(windows).forEach(function (id) {
        var m = windows[id];
        if (!top || parseInt(m.el.style.zIndex, 10) > parseInt(top.el.style.zIndex, 10)) {
          top = m;
        }
      });
      if (top) focusWindow(top.appId);
      else clearActiveTaskbar();
    }
  }

  function clearActiveTaskbar() {
    Object.keys(windows).forEach(function (id) {
      windows[id].taskbarBtn.classList.remove("active");
    });
  }

  function toggleMaximize(model) {
    var app = model.app;
    if (model.maximized) {
      // Restore.
      var r = model.prevRect;
      model.el.style.left = r.left + "px";
      model.el.style.top = r.top + "px";
      model.el.style.width = r.w + "px";
      model.el.style.height = r.h + "px";
      model.el.classList.remove("maximized");
      model.maximized = false;
    } else {
      // Save current geometry and snap to viewport (above taskbar).
      if (!model.prevRect) {
        model.prevRect = {
          left: parseInt(model.el.style.left, 10),
          top: parseInt(model.el.style.top, 10),
          w: parseInt(model.el.style.width, 10),
          h: parseInt(model.el.style.height, 10)
        };
      }
      model.el.style.left = "0px";
      model.el.style.top = "0px";
      model.el.style.width = window.innerWidth + "px";
      model.el.style.height = (window.innerHeight - 48) + "px";
      model.el.classList.add("maximized");
      model.maximized = true;
    }
    focusWindow(appId);
  }

  function modelFor(btn) {
    var winEl = btn.closest(".window");
    var appId = winEl.dataset.app;
    return windows[appId];
  }

  /* ---- Dragging (title bar) ----------------------------------------- */
  function setupTitleBarDrag(win, model) {
    var titleBar = win.querySelector(".title-bar");

    // Dragging should not start from interactive controls.
    var noDrag = titleBar.querySelectorAll(".win-btn");

    titleBar.addEventListener("mousedown", function (e) {
      if (model.maximized) return; // don't drag when maximized
      if (Array.prototype.indexOf.call(noDrag, e.target) !== -1) return;
      if (e.button !== 0) return;

      // Focus on drag start.
      focusWindow(model.appId);

      var startX = e.clientX;
      var startY = e.clientY;
      var origLeft = parseInt(win.style.left, 10);
      var origTop = parseInt(win.style.top, 10);
      var moved = false;

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;

        var newLeft = origLeft + dx;
        var newTop = origTop + dy;

        // Constrain to viewport: keep at least part of the title bar visible.
        var maxLeft = window.innerWidth - 80;
        var maxTop = window.innerHeight - 88; // keep title bar above taskbar
        var minLeft = - (win.offsetWidth - 120);
        var minTop = -40;

        newLeft = clamp(newLeft, Math.min(0, minLeft), Math.min(window.innerWidth - 60, maxLeft));
        newTop = clamp(newTop, Math.min(0, minTop), Math.min(window.innerHeight - 48 - 44, maxTop));

        win.style.left = newLeft + "px";
        win.style.top = newTop + "px";
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("no-select");
        // If it was just a click (no move), focus is handled by mousedown.
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.classList.add("no-select");
      e.preventDefault();
    });
  }

  /* ---- Resizing (bottom-right handle) ------------------------------- */
  function setupResize(win, model) {
    var handle = win.querySelector(".resize-handle");
    if (!handle) return;

    handle.addEventListener("mousedown", function (e) {
      if (model.maximized) return;
      e.stopPropagation();
      if (e.button !== 0) return;

      focusWindow(model.appId);
      var startX = e.clientX;
      var startY = e.clientY;
      var origW = win.offsetWidth;
      var origH = win.offsetHeight;

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var dy = ev.clientY - startY;
        var newW = Math.max(240, origW + dx);
        var newH = Math.max(160, origH + dy);
        // Keep window within viewport width and above taskbar.
        var maxW = window.innerWidth - parseInt(win.style.left, 10) - 4;
        var maxH = window.innerHeight - 48 - (parseInt(win.style.top, 10) + 40);
        newW = Math.min(newW, maxW);
        newH = Math.min(newH, maxH);
        win.style.width = newW + "px";
        win.style.height = newH + "px";
      }

      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.classList.remove("no-select");
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.classList.add("no-select");
      e.preventDefault();
    });
  }

  /* ============================================================
     Taskbar
     ============================================================ */
  function renderTaskbarButton(model) {
    var app = model.app;
    var btn = document.createElement("button");
    btn.className = "taskbar-button";
    btn.type = "button";
    btn.dataset.app = appId;
    btn.innerHTML =
      '<span class="tb-icon" style="background:' + app.color + '">' + app.glyph + "</span>" +
      '<span class="tb-title">' + app.name + "</span>";

    btn.addEventListener("click", function () {
      var m = windows[appId];
      if (!m) return;
      if (m.minimized) {
        focusWindow(m.appId);
      } else if (activeWindowId === m.appId) {
        // Clicking the active window's button minimizes it (toggle).
        onWindowMinimize({ stopPropagation: function () {}, currentTarget: m.el.querySelector(".win-min") });
      } else {
        focusWindow(m.appId);
      }
    });

    // Insert before the clock area (taskbar-apps is flexible, clock is sibling).
    taskbarApps.appendChild(btn);
    model.taskbarBtn = btn;
  }

  /* ---- Clock --------------------------------------------------------- */
  function updateClock() {
    var now = new Date();
    var h = now.getHours();
    var m = now.getMinutes();
    var hh = String(h).padStart(2, "0");
    var mm = String(m).padStart(2, "0");
    clockEl.textContent = hh + ":" + mm;
  }

  /* ============================================================
     Desktop context menu (right-click empty desktop)
     ============================================================ */
  function openDesktopMenu(x, y) {
    menuEl.classList.remove("hidden");
    // Position within viewport.
    var mw = menuEl.offsetWidth;
    var mh = menuEl.offsetHeight;
    var left = Math.min(x, window.innerWidth - mw - 4);
    var top = Math.min(y, window.innerHeight - mh - 4);
    menuEl.style.left = Math.max(4, left) + "px";
    menuEl.style.top = Math.max(4, top) + "px";
  }

  function closeDesktopMenu() {
    menuEl.classList.add("hidden");
  }

  function setupContextMenu() {
    desktopEl.addEventListener("contextmenu", function (e) {
      // Only open on empty desktop area (not on a window or icon).
      var target = e.target;
      if (target.closest(".window") || target.closest(".icons") || target.closest("#taskbar")) {
        return;
      }
      e.preventDefault();
      openDesktopMenu(e.clientX, e.clientY);
    });

    // Menu item actions.
    menuEl.addEventListener("click", function (e) {
      var item = e.target.closest(".menu-item");
      if (!item) return;
      var action = item.dataset.action;
      closeDesktopMenu();
      if (action === "open-notepad") openApp("notepad");
      else if (action === "open-calculator") openApp("calculator");
      else if (action === "open-minesweeper") openApp("minesweeper");
      else if (action === "open-spider") openApp("spider");
    });
  }

  // Dismiss the context menu on any other click or scroll.
  function setupMenuDismiss() {
    document.addEventListener("mousedown", function (e) {
      if (!menuEl.classList.contains("hidden") && !menuEl.contains(e.target)) {
        closeDesktopMenu();
      }
    });
    document.addEventListener("scroll", closeDesktopMenu, true);
    window.addEventListener("resize", closeDesktopMenu);
  }

  /* ============================================================
     Utilities
     ============================================================ */
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /* ============================================================
     Init
     ============================================================ */
  function init() {
    buildDesktopIcons();
    setupContextMenu();
    setupMenuDismiss();
    updateClock();
    setInterval(updateClock, 1000);

    // Convenience: expose a tiny API for manual testing.
    window.__os = {
      openApp: openApp,
      windows: windows,
      APPS: APPS
    };
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
