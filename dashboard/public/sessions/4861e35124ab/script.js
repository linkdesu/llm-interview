/* ============================================================
   Browser OS — script.js
   Ticket 2: Wallpaper — right-click context menu on the empty
   desktop, "Change wallpaper" preset picker, localStorage
   persistence. The rest of the shell (windows, apps) belongs
   to the other tickets; this file currently wires up the
   desktop, context menu, picker and taskbar clock.
   ============================================================ */

'use strict';

/* ---------- Wallpaper data (ticket 2) ---------- */
const WALLPAPER_STORAGE_KEY = 'browseros.wallpaper';
const DEFAULT_WALLPAPER = 'aurora';

const WALLPAPERS = [
  { id: 'aurora', name: 'Aurora' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'graphite', name: 'Graphite' },
  { id: 'mist', name: 'Mist' },
  { id: 'dunes', name: 'Dunes' },
  { id: 'grid', name: 'Grid' },
  { id: 'bubbles', name: 'Bubbles' }
];

/* ---------- DOM references ---------- */
const desktopEl = document.getElementById('desktop');
const contextMenuEl = document.getElementById('context-menu');
const pickerEl = document.getElementById('wallpaper-picker');
const pickerGridEl = document.getElementById('picker-grid');
const pickerCloseEl = document.getElementById('picker-close');
const clockEl = document.getElementById('clock');

let currentWallpaper = DEFAULT_WALLPAPER;

/* ---------- Wallpaper (ticket 2) ---------- */
function readStoredWallpaper() {
  try {
    const stored = localStorage.getItem(WALLPAPER_STORAGE_KEY);
    if (stored && WALLPAPERS.some((w) => w.id === stored)) return stored;
  } catch (_) {
    /* storage unavailable (e.g. blocked on file://) — fall back */
  }
  return DEFAULT_WALLPAPER;
}

function applyWallpaper(id) {
  if (!WALLPAPERS.some((w) => w.id === id)) return;
  currentWallpaper = id;

  // Swap the preset class on the desktop.
  WALLPAPERS.forEach((w) => desktopEl.classList.remove('wallpaper-' + w.id));
  desktopEl.classList.add('wallpaper-' + id);

  // Keep the picker's selection ring in sync.
  pickerGridEl.querySelectorAll('.picker-thumb').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.wallpaper === id));
  });

  try {
    localStorage.setItem(WALLPAPER_STORAGE_KEY, id);
  } catch (_) {
    /* persisting is best-effort */
  }
}

function buildPickerThumbnails() {
  WALLPAPERS.forEach((wp) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-thumb';
    btn.dataset.wallpaper = wp.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.title = wp.name;

    const swatch = document.createElement('span');
    swatch.className = 'picker-thumb-swatch wallpaper wallpaper-' + wp.id;
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'picker-thumb-name';
    label.textContent = wp.name;

    btn.append(swatch, label);
    btn.addEventListener('click', () => applyWallpaper(wp.id));
    pickerGridEl.appendChild(btn);
  });
}

function openPicker() {
  closeContextMenu();
  pickerEl.hidden = false;
  pickerCloseEl.focus();
}

function closePicker() {
  pickerEl.hidden = true;
}

/* ---------- Context menu (ticket 2) ---------- */
function isDesktopEmptyTarget(target) {
  if (!desktopEl.contains(target)) return false;
  // Over an icon (or a future window) it is not the "empty" desktop.
  return !target.closest('.desktop-icon, .window');
}

function openContextMenu(clientX, clientY) {
  contextMenuEl.hidden = false;

  // Clamp so the menu stays inside the viewport.
  const rect = contextMenuEl.getBoundingClientRect();
  const x = Math.max(8, Math.min(clientX, window.innerWidth - rect.width - 8));
  const y = Math.max(8, Math.min(clientY, window.innerHeight - rect.height - 8));
  contextMenuEl.style.left = x + 'px';
  contextMenuEl.style.top = y + 'px';

  contextMenuEl.querySelector('[data-action="change-wallpaper"]').focus();
}

function closeContextMenu() {
  contextMenuEl.hidden = true;
}

/* ---------- Taskbar clock (shell foundation) ---------- */
function formatClock(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return h + ':' + m;
}

function updateClock() {
  clockEl.textContent = formatClock(new Date());
}

/* ---------- Event wiring & init ---------- */
function wireEvents() {
  // Right-click on the desktop: suppress the native menu everywhere in
  // the desktop area, open our menu only over the empty part of it.
  desktopEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!isDesktopEmptyTarget(e.target)) return;
    openContextMenu(e.clientX, e.clientY);
  });

  // "Change wallpaper" menu item opens the preset picker.
  contextMenuEl.querySelector('[data-action="change-wallpaper"]')
    .addEventListener('click', openPicker);

  // Clicking outside the menu closes it; clicking the backdrop closes
  // the picker.
  document.addEventListener('click', (e) => {
    if (!contextMenuEl.hidden && !contextMenuEl.contains(e.target)) {
      closeContextMenu();
    }
    if (!pickerEl.hidden && e.target === pickerEl) {
      closePicker();
    }
  });

  pickerCloseEl.addEventListener('click', closePicker);

  // Escape closes the picker first, then the context menu.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!pickerEl.hidden) closePicker();
    closeContextMenu();
  });

  // No native context menu on top of the picker overlay.
  pickerEl.addEventListener('contextmenu', (e) => e.preventDefault());
}

function init() {
  buildPickerThumbnails();
  applyWallpaper(readStoredWallpaper());
  wireEvents();
  updateClock();
  setInterval(updateClock, 1000);
}

init();

/* Handle exposed for in-page tests / debugging. */
window.browserOs = {
  getWallpaper: () => currentWallpaper,
  applyWallpaper: applyWallpaper,
  wallpapers: WALLPAPERS,
  storageKey: WALLPAPER_STORAGE_KEY
};
