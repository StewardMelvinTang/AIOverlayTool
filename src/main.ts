import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeTheme,
  nativeImage,
  net,
  screen,
  shell,
  Tray,
  type Rectangle,
  type WebContents
} from 'electron';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Store from 'electron-store';
import {
  deepMergeSettings,
  defaultSettings,
  isQuickAskProvider,
  type DeepPartial,
  type FloatAISettings,
  type Provider
} from './shared/settings';
import {
  providerWebSessionPartition,
  type ProviderAudioState,
  type ProviderIconPickResult,
  type PopupPosition,
  type PopupSize,
  type QuickAskSubmitPayload
} from './shared/bridge';
import {
  type PortableBackupFile,
  type PortableBackupResult,
  type PortableBackupSummary,
  type PortableProviderIcon,
  portableBackupExtension,
  portableBackupFormat,
  portableBackupVersion
} from './shared/backup';
import type { ScratchPadNotePatch } from './shared/addons';
import {
  getAddonDownloads,
  getAddonState,
  installAddon,
  normalizeAddonStorageState,
  restoreAddonState,
  uninstallAddon
} from './main/addonStorage';
import {
  createScratchPadNote,
  deleteScratchPadNote,
  getScratchPadNotes,
  normalizeScratchPadStorageState,
  restoreScratchPadState,
  updateScratchPadNote
} from './main/scratchPadStorage';
import {
  getDiagnosticsDirectory,
  initializeDiagnostics,
  logError,
  logInfo,
  logWarn
} from './main/diagnostics';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const appDisplayName = 'Float AI';
const appUserModelId = 'com.floatai.launcher';
const macDefaultHotkey = 'Option+Space';
const quickAskDefaultHotkey = isMac ? 'Command+Shift+K' : 'Alt+Shift+K';
const platformDefaultSettings = isMac
  ? deepMergeSettings(defaultSettings, { globalHotkey: macDefaultHotkey, quickAsk: { hotkey: quickAskDefaultHotkey } })
  : deepMergeSettings(defaultSettings, { quickAsk: { hotkey: quickAskDefaultHotkey } });

if (!app.isPackaged && process.env.FLOAT_AI_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.FLOAT_AI_USER_DATA_DIR));
}

const store = new Store<FloatAISettings>({
  name: 'float-ai-launcher',
  defaults: platformDefaultSettings
});

let settings = deepMergeSettings(platformDefaultSettings, store.store as DeepPartial<FloatAISettings>);
let popupWindow: BrowserWindow | null = null;
let quickAskWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let registeredHotkey: string | null = null;
let registeredQuickAskHotkey: string | null = null;
let currentProviderId = settings.defaultProviderId;
let quickAskDisplayId: number | undefined;
let savePositionTimer: NodeJS.Timeout | undefined;
let popupHideTimer: NodeJS.Timeout | undefined;
let quickAskHideTimer: NodeJS.Timeout | undefined;
let popupUnresponsiveTimer: NodeJS.Timeout | undefined;
let quickAskUnresponsiveTimer: NodeJS.Timeout | undefined;
let resourceMonitorTimer: NodeJS.Timeout | undefined;
let isPopupRendererReady = false;
let isQuickAskRendererReady = false;
let isQuitting = false;
let isHiding = false;
let isQuickAskHiding = false;
let isShortcutCaptureActive = false;
let popupTopGuardTimer: NodeJS.Timeout | undefined;
let popupTopReassertTimers: NodeJS.Timeout[] = [];
let popupMoveIdleTimer: NodeJS.Timeout | undefined;
let isPopupMoving = false;
let isPopupResizeInProgress = false;
let popupInteractiveMoveSession: PopupInteractiveMoveSession | undefined;
let lastMemoryPressureAt = 0;
const webviewUnresponsiveTimers = new Map<number, NodeJS.Timeout>();
const popupRecoveryAttempts: number[] = [];
const quickAskRecoveryAttempts: number[] = [];


type PopupBoundsOptions = {
  anchorToCursor?: boolean;
  centerOnDisplayId?: number;
};

type PopupInteractiveMoveSession = {
  startCursorX: number;
  startCursorY: number;
  startBounds: Rectangle;
};

type WebsiteIconCandidate = {
  url: string;
  score: number;
};

type AlwaysOnTopLevel = NonNullable<Parameters<BrowserWindow['setAlwaysOnTop']>[1]>;

const popupAlwaysOnTopLevel: AlwaysOnTopLevel = isWindows ? 'screen-saver' : 'floating';
const popupTopGuardIntervalMs = 900;
const popupTopReassertDelaysMs = [0, 80, 240];
const popupHideAnimationMs = 120;
const quickAskHideAnimationMs = 150;
const popupUnresponsiveRecoveryMs = 8000;
const providerUnresponsiveRecoveryMs = 12000;
const resourceMonitorIntervalMs = 2 * 60 * 1000;
const highMemoryPrivateBytesKb = 1536 * 1024;
const memoryPressureCooldownMs = 10 * 60 * 1000;
const automaticRecoveryWindowMs = 60 * 1000;
const maximumAutomaticRecoveries = 3;
const quickAskWindowWidth = 740;
const quickAskWindowHeight = 300;
const maxPortableBackupBytes = 32 * 1024 * 1024;
const maxPortableIconBytes = 5 * 1024 * 1024;

if (!settings.performance.hardwareAcceleration) {
  app.disableHardwareAcceleration();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.exit(0);
}

process.title = appDisplayName;
app.setName(appDisplayName);

if (isWindows) {
  app.setAppUserModelId(appUserModelId);
}

if (gotLock) {
  initializeDiagnostics();
}

function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

function getAppIconPath(): string {
  const customPath = path.join(app.getAppPath(), 'icon_256.png');
  if (existsSync(customPath)) {
    return customPath;
  }
  return path.join(__dirname, '../icon_256.png');
}

function getTrayIconPath(): string {
  const customPath = path.join(app.getAppPath(), 'icon_white.png');
  if (existsSync(customPath)) {
    return customPath;
  }
  return path.join(__dirname, '../icon_white.png');
}

function getRendererUrl(windowName: 'popup' | 'settings' | 'quickAsk'): string {
  if (isDev) {
    const baseUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
    return `${baseUrl}?window=${windowName}`;
  }

  return path.join(__dirname, '../dist-renderer/index.html');
}

function loadRenderer(window: BrowserWindow, windowName: 'popup' | 'settings' | 'quickAsk'): void {
  let loadPromise: Promise<void>;

  if (isDev) {
    loadPromise = window.loadURL(getRendererUrl(windowName));
  } else {
    loadPromise = window.loadFile(getRendererUrl(windowName), {
      query: {
        window: windowName
      }
    });
  }

  void loadPromise.catch((error) => {
    logError('renderer-load-rejected', error, { windowName });
  });
}

function isAllowedProviderPopupUrl(url: string): boolean {
  if (!url || url === 'about:blank') {
    return true;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function openExternalUrl(url: string): void {
  if (!url || url === 'about:blank') {
    return;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== 'mailto:' && parsedUrl.protocol !== 'tel:') {
      return;
    }
  } catch {
    return;
  }

  void shell.openExternal(url).catch((error) => {
    console.warn(`Could not open external URL "${url}".`, error);
  });
}

function providerPopupWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    title: `${appDisplayName} - Sign In`,
    width: 920,
    height: 760,
    minWidth: 480,
    minHeight: 520,
    parent: popupWindow ?? undefined,
    autoHideMenuBar: true,
    fullscreenable: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: providerWebSessionPartition,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false
    }
  };
}

function configureProviderPopupWindow(window: BrowserWindow): void {
  if (isMac) {
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isAllowedProviderPopupUrl(url)) {
      openExternalUrl(url);
      return { action: 'deny' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: providerPopupWindowOptions()
    };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedProviderPopupUrl(url)) {
      event.preventDefault();
      openExternalUrl(url);
    }
  });
}

function getSelectedProvider(): Provider {
  return (
    settings.providers.find((provider) => provider.id === currentProviderId) ??
    settings.providers.find((provider) => provider.id === settings.defaultProviderId) ??
    settings.providers[0]
  );
}

function calculatePopupBounds(options: PopupBoundsOptions = {}): Rectangle {
  const width = settings.popup.width;
  const height = settings.popup.height;

  if (options.anchorToCursor) {
    return calculateCursorAnchoredPopupBounds(width, height);
  }

  if (options.centerOnDisplayId !== undefined) {
    return calculateDisplayCenteredPopupBounds(width, height, options.centerOnDisplayId);
  }

  if (
    settings.popup.rememberPosition &&
    Number.isFinite(settings.popup.x) &&
    Number.isFinite(settings.popup.y)
  ) {
    const savedRect = {
      x: settings.popup.x!,
      y: settings.popup.y!,
      width,
      height
    };

    const displays = screen.getAllDisplays();
    const isVisible = displays.some((display) => {
      const db = display.bounds;
      const margin = 50;
      return !(
        savedRect.x + margin >= db.x + db.width ||
        savedRect.x + savedRect.width - margin <= db.x ||
        savedRect.y + margin >= db.y + db.height ||
        savedRect.y + savedRect.height - margin <= db.y
      );
    });

    if (isVisible) {
      return savedRect;
    }
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const x = Math.round(display.workArea.x + display.workArea.width - width - 24);
  const y = Math.round(display.workArea.y + 48);

  return { x, y, width, height };
}

function calculateCursorAnchoredPopupBounds(width: number, height: number): Rectangle {
  const cursorPoint = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursorPoint);
  const margin = 14;
  const pointerOffset = 12;
  const workArea = display.workArea;
  const minX = workArea.x + margin;
  const maxX = workArea.x + workArea.width - width - margin;
  const minY = workArea.y + margin;
  const maxY = workArea.y + workArea.height - height - margin;
  const preferredX = cursorPoint.x - Math.round(width / 2);
  const preferredY = cursorPoint.y + pointerOffset;

  return {
    x: clamp(preferredX, minX, Math.max(minX, maxX)),
    y: clamp(preferredY, minY, Math.max(minY, maxY)),
    width,
    height
  };
}

function calculateDisplayCenteredPopupBounds(width: number, height: number, displayId: number): Rectangle {
  const display =
    screen.getAllDisplays().find((item) => item.id === displayId) ??
    screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const workArea = display.workArea;
  const margin = 18;
  const minX = workArea.x + margin;
  const maxX = workArea.x + workArea.width - width - margin;
  const minY = workArea.y + margin;
  const maxY = workArea.y + workArea.height - height - margin;

  return {
    x: clamp(Math.round(workArea.x + (workArea.width - width) / 2), minX, Math.max(minX, maxX)),
    y: clamp(Math.round(workArea.y + (workArea.height - height) / 2), minY, Math.max(minY, maxY)),
    width,
    height
  };
}

function calculateQuickAskBounds(display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())): Rectangle {
  const workArea = display.workArea;
  const width = clamp(quickAskWindowWidth, 320, Math.max(320, workArea.width - 48));
  const height = quickAskWindowHeight;

  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getUsableWebContents(window: BrowserWindow | null): WebContents | null {
  if (!window || window.isDestroyed()) {
    return null;
  }

  try {
    const contents = window.webContents as WebContents | null;
    return contents && !contents.isDestroyed() ? contents : null;
  } catch {
    return null;
  }
}

function createPopupWindow(): BrowserWindow {
  if (popupWindow && !popupWindow.isDestroyed()) {
    return popupWindow;
  }

  popupWindow = null;
  clearPopupHideTimer();
  clearPopupUnresponsiveTimer();
  isHiding = false;

  const iconPath = getAppIconPath();
  const iconImage = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  popupWindow = new BrowserWindow({
    ...calculatePopupBounds(),
    title: appDisplayName,
    icon: iconImage,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: settings.popup.alwaysOnTop,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true
    }
  });
  const createdPopupWindow = popupWindow;
  const createdPopupWebContents = createdPopupWindow.webContents;
  const createdPopupWebContentsId = createdPopupWebContents.id;
  let popupRecoveryStarted = false;

  const recoverPopup = (reason: string) => {
    if (popupRecoveryStarted) {
      return;
    }

    popupRecoveryStarted = true;
    recoverPopupRenderer(createdPopupWindow, reason);
  };

  if (isMac) {
    popupWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  applyPopupTopMost({ moveToTop: true });

  popupWindow.on('blur', () => {
    if (!isShortcutCaptureActive && settings.popup.hideOnBlur) {
      hidePopup();
      return;
    }

    schedulePopupTopMostReassert();
  });

  popupWindow.on('focus', () => {
    schedulePopupTopMostReassert();
  });

  popupWindow.on('show', () => {
    schedulePopupTopMostReassert();
  });

  popupWindow.on('restore', () => {
    schedulePopupTopMostReassert();
  });

  popupWindow.on('always-on-top-changed', (_event, isAlwaysOnTop) => {
    if (!isAlwaysOnTop && settings.popup.alwaysOnTop) {
      schedulePopupTopMostReassert();
    }
  });

  popupWindow.on('move', () => {
    markPopupMoving();
    queuePopupPositionSave();
  });


  const minimizableWindow = popupWindow as unknown as {
    on: (event: 'minimize', listener: (event: { preventDefault: () => void }) => void) => void;
  };

  minimizableWindow.on('minimize', (event) => {
    event.preventDefault();
  });

  popupWindow.on('maximize', () => {
    popupWindow?.unmaximize();
  });

  popupWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hidePopup();
    }
  });

  popupWindow.on('closed', () => {
    if (popupWindow !== createdPopupWindow) {
      return;
    }

    clearPopupHideTimer();
    clearPopupUnresponsiveTimer();
    stopPopupTopGuard();
    resetPopupMoving();
    setShortcutCaptureActive(false);
    popupWindow = null;
    isPopupRendererReady = false;
    isHiding = false;
  });

  createdPopupWebContents.on('did-finish-load', () => {
    if (popupWindow !== createdPopupWindow) {
      return;
    }

    isPopupRendererReady = true;
    broadcastSettings();
    broadcastProvider();
  });

  createdPopupWebContents.on('unresponsive', () => {
    if (isQuitting || popupWindow !== createdPopupWindow) {
      return;
    }

    logWarn('popup-renderer-unresponsive', { webContentsId: createdPopupWebContentsId });
    clearPopupUnresponsiveTimer();
    popupUnresponsiveTimer = setTimeout(() => {
      popupUnresponsiveTimer = undefined;

      if (isQuitting || popupWindow !== createdPopupWindow || createdPopupWindow.isDestroyed()) {
        return;
      }

      console.warn('Popup renderer stayed unresponsive; recovering it automatically.');
      recoverPopup('unresponsive-timeout');
    }, popupUnresponsiveRecoveryMs);
  });

  createdPopupWebContents.on('responsive', () => {
    if (popupWindow === createdPopupWindow) {
      logInfo('popup-renderer-responsive', { webContentsId: createdPopupWebContentsId });
      clearPopupUnresponsiveTimer();
    }
  });

  createdPopupWebContents.on('render-process-gone', (_event, details) => {
    if (isQuitting || popupWindow !== createdPopupWindow || details.reason === 'clean-exit') {
      return;
    }

    console.warn(`Popup renderer exited unexpectedly (${details.reason}); recovering it automatically.`);
    logWarn('popup-render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      webContentsId: createdPopupWebContentsId
    });
    recoverPopup(`render-process-gone:${details.reason}`);
  });

  createdPopupWebContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      logWarn('popup-renderer-load-failed', { errorCode, errorDescription });
    }
  });

  popupWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') {
      if (!createdPopupWebContents.isDestroyed()) {
        createdPopupWebContents.send('webview:navigate', 'back');
      }
    }

    if (command === 'browser-forward') {
      if (!createdPopupWebContents.isDestroyed()) {
        createdPopupWebContents.send('webview:navigate', 'forward');
      }
    }
  });

  createdPopupWebContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch((error) => {
      logError('popup-open-external-failed', error);
    });
    return { action: 'deny' };
  });

  createdPopupWebContents.on('context-menu', (event) => {
    event.preventDefault();
  });

  createdPopupWebContents.on('before-input-event', (event, input) => {
    if (switchProviderFromShortcutInput(input)) {
      event.preventDefault();
    }
  });

  loadRenderer(popupWindow, 'popup');
  return popupWindow;
}

function sendToPopup(channel: string, ...args: unknown[]): void {
  const window = popupWindow;
  const contents = getUsableWebContents(window);

  if (!window || !contents) {
    return;
  }

  const send = () => {
    if (window.isDestroyed() || contents.isDestroyed()) {
      return;
    }

    try {
      contents.send(channel, ...args);
    } catch (error) {
      console.warn(`Could not send popup event "${channel}".`, error);
    }
  };

  if (isPopupRendererReady) {
    send();
    return;
  }

  contents.once('did-finish-load', send);
}

function clearPopupHideTimer(): void {
  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = undefined;
  }
}

function clearPopupUnresponsiveTimer(): void {
  if (popupUnresponsiveTimer) {
    clearTimeout(popupUnresponsiveTimer);
    popupUnresponsiveTimer = undefined;
  }
}

function recoverPopupRenderer(window: BrowserWindow, reason: string): void {
  const wasVisible = !window.isDestroyed() && window.isVisible();
  isPopupRendererReady = false;
  setShortcutCaptureActive(false);
  clearPopupHideTimer();
  clearPopupUnresponsiveTimer();
  isHiding = false;
  stopPopupTopGuard();

  logWarn('popup-renderer-recovery', { reason, wasVisible });

  if (!window.isDestroyed()) {
    window.destroy();
  }

  if (!wasVisible || isQuitting || !reserveAutomaticRecovery(popupRecoveryAttempts)) {
    return;
  }

  setTimeout(() => {
    if (!isQuitting && (!popupWindow || popupWindow.isDestroyed())) {
      showPopup();
    }
  }, 300);
}

function runRendererRecoverySmokeTest(): void {
  const initialWindow = createPopupWindow();
  const initialContents = getUsableWebContents(initialWindow);

  if (!initialContents) {
    logError('renderer-recovery-smoke-test-failed', new Error('Popup web contents were unavailable.'));
    app.exit(1);
    return;
  }

  const initialWebContentsId = initialContents.id;
  let finished = false;
  let recoveryPoll: NodeJS.Timeout | undefined;

  const finish = (passed: boolean, reason: string) => {
    if (finished) {
      return;
    }

    finished = true;
    if (recoveryPoll) {
      clearInterval(recoveryPoll);
    }

    const details = { reason, initialWebContentsId };
    if (passed) {
      logInfo('renderer-recovery-smoke-test-passed', details);
    } else {
      logWarn('renderer-recovery-smoke-test-failed', details);
    }

    setTimeout(() => app.exit(passed ? 0 : 1), 100);
  };

  const deadline = setTimeout(() => finish(false, 'recovery-timeout'), 15_000);
  deadline.unref();

  initialContents.once('render-process-gone', () => {
    recoveryPoll = setInterval(() => {
      const recoveredWindow = popupWindow;
      const recoveredContents = getUsableWebContents(recoveredWindow);

      if (
        recoveredWindow &&
        recoveredWindow !== initialWindow &&
        recoveredContents &&
        recoveredContents.id !== initialWebContentsId &&
        isPopupRendererReady
      ) {
        clearTimeout(deadline);
        finish(true, 'popup-recreated-and-ready');
      }
    }, 100);
  });

  initialContents.once('did-finish-load', () => {
    initialWindow.show();
    setTimeout(() => {
      if (initialContents.isDestroyed()) {
        finish(false, 'initial-renderer-disappeared-before-forced-crash');
        return;
      }

      logInfo('renderer-recovery-smoke-test-forcing-crash', { initialWebContentsId });
      initialContents.forcefullyCrashRenderer();
    }, 250);
  });
}

function reserveAutomaticRecovery(attempts: number[]): boolean {
  const cutoff = Date.now() - automaticRecoveryWindowMs;

  while (attempts.length > 0 && attempts[0] < cutoff) {
    attempts.shift();
  }

  if (attempts.length >= maximumAutomaticRecoveries) {
    logWarn('automatic-recovery-rate-limited', {
      attempts: attempts.length,
      windowMs: automaticRecoveryWindowMs
    });
    return false;
  }

  attempts.push(Date.now());
  return true;
}

function showPopup(options: PopupBoundsOptions = {}): void {
  const window = createPopupWindow();
  clearPopupHideTimer();
  applyPopupSettings(options, true);

  isHiding = false;
  window.show();
  schedulePopupTopMostReassert();
  window.focus();
  syncTray();

  sendToPopup('popup:animate', 'in');
  sendToPopup('settings:changed', settings);
  sendToPopup('provider:changed', getSelectedProvider());
}

function hidePopup(): void {
  setShortcutCaptureActive(false);

  const window = popupWindow;

  if (!window || window.isDestroyed()) {
    clearPopupHideTimer();
    isHiding = false;
    return;
  }

  if (isHiding) {
    return;
  }

  resetPopupMoving();
  stopPopupTopGuard();
  clearPopupHideTimer();
  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
    savePositionTimer = undefined;
  }

  let bounds: Rectangle | undefined;
  try {
    bounds = settings.popup.rememberPosition ? window.getBounds() : undefined;
  } catch (error) {
    console.warn('Could not read the popup position before hiding.', error);
  }

  isHiding = true;

  popupHideTimer = setTimeout(() => {
    popupHideTimer = undefined;

    if (popupWindow !== window || !isHiding) {
      return;
    }

    try {
      if (!window.isDestroyed()) {
        window.hide();
      }
    } catch (error) {
      console.warn('Could not hide the popup window cleanly.', error);
    } finally {
      if (popupWindow === window) {
        isHiding = false;
        stopPopupTopGuard();
        syncTray();
      }
    }

    if (bounds) {
      setImmediate(() => {
        try {
          savePopupPosition({ x: bounds.x, y: bounds.y }, false);
        } catch (error) {
          console.warn('Could not save the popup position after hiding.', error);
        }
      });
    }
  }, popupHideAnimationMs);

  sendToPopup('popup:animate', 'out');
}

function togglePopup(options: PopupBoundsOptions = {}): void {
  if (isShortcutCaptureActive) {
    setShortcutCaptureActive(false);
    showPopup(options);
    return;
  }

  if (popupWindow?.isVisible() && !isHiding) {
    hidePopup();
    return;
  }

  showPopup(options);
}

function openIntegratedSettings(): void {
  const window = createPopupWindow();
  clearPopupHideTimer();
  applyPopupSettings({}, true);

  isHiding = false;
  window.show();
  schedulePopupTopMostReassert();
  window.focus();
  syncTray();

  sendToPopup('popup:animate', 'in');
  sendToPopup('settings:changed', settings);
  sendToPopup('popup:openSettings');
}

function createQuickAskWindow(): BrowserWindow {
  if (quickAskWindow && !quickAskWindow.isDestroyed()) {
    return quickAskWindow;
  }

  quickAskWindow = null;
  clearQuickAskHideTimer();
  isQuickAskHiding = false;

  const iconPath = getAppIconPath();
  const iconImage = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : undefined;

  quickAskWindow = new BrowserWindow({
    ...calculateQuickAskBounds(),
    title: `${appDisplayName} - Quick Ask`,
    icon: iconImage,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: false
    }
  });
  const createdQuickAskWindow = quickAskWindow;
  const createdQuickAskWebContents = createdQuickAskWindow.webContents;
  const createdQuickAskWebContentsId = createdQuickAskWebContents.id;
  let quickAskRecoveryStarted = false;

  const recoverQuickAsk = (reason: string) => {
    if (quickAskRecoveryStarted) {
      return;
    }

    quickAskRecoveryStarted = true;
    recoverQuickAskRenderer(createdQuickAskWindow, reason);
  };

  if (isMac) {
    quickAskWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  quickAskWindow.setAlwaysOnTop(true, popupAlwaysOnTopLevel);

  quickAskWindow.on('blur', () => {
    hideQuickAsk();
  });

  quickAskWindow.on('closed', () => {
    if (quickAskWindow !== createdQuickAskWindow) {
      return;
    }

    clearQuickAskHideTimer();
    clearQuickAskUnresponsiveTimer();
    quickAskWindow = null;
    isQuickAskRendererReady = false;
    isQuickAskHiding = false;
  });

  createdQuickAskWebContents.once('did-finish-load', () => {
    isQuickAskRendererReady = true;
    sendToQuickAsk('settings:changed', settings);
  });

  createdQuickAskWebContents.on('unresponsive', () => {
    if (isQuitting || quickAskWindow !== createdQuickAskWindow) {
      return;
    }

    logWarn('quick-ask-renderer-unresponsive', { webContentsId: createdQuickAskWebContentsId });
    clearQuickAskUnresponsiveTimer();
    quickAskUnresponsiveTimer = setTimeout(() => {
      quickAskUnresponsiveTimer = undefined;

      if (isQuitting || quickAskWindow !== createdQuickAskWindow || createdQuickAskWindow.isDestroyed()) {
        return;
      }

      recoverQuickAsk('unresponsive-timeout');
    }, popupUnresponsiveRecoveryMs);
  });

  createdQuickAskWebContents.on('responsive', () => {
    if (quickAskWindow === createdQuickAskWindow) {
      logInfo('quick-ask-renderer-responsive', { webContentsId: createdQuickAskWebContentsId });
      clearQuickAskUnresponsiveTimer();
    }
  });

  createdQuickAskWebContents.on('render-process-gone', (_event, details) => {
    if (isQuitting || quickAskWindow !== createdQuickAskWindow || details.reason === 'clean-exit') {
      return;
    }

    logWarn('quick-ask-render-process-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      webContentsId: createdQuickAskWebContentsId
    });
    recoverQuickAsk(`render-process-gone:${details.reason}`);
  });

  createdQuickAskWebContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      logWarn('quick-ask-renderer-load-failed', { errorCode, errorDescription });
    }
  });

  createdQuickAskWebContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url).catch((error) => {
      logError('quick-ask-open-external-failed', error);
    });
    return { action: 'deny' };
  });

  createdQuickAskWebContents.on('context-menu', (event) => {
    event.preventDefault();
  });

  loadRenderer(quickAskWindow, 'quickAsk');
  return quickAskWindow;
}

function sendToQuickAsk(channel: string, ...args: unknown[]): void {
  const window = quickAskWindow;
  const contents = getUsableWebContents(window);

  if (!window || !contents) {
    return;
  }

  const send = () => {
    if (window.isDestroyed() || contents.isDestroyed()) {
      return;
    }

    try {
      contents.send(channel, ...args);
    } catch (error) {
      console.warn(`Could not send Quick Ask event "${channel}".`, error);
    }
  };

  if (isQuickAskRendererReady) {
    send();
    return;
  }

  contents.once('did-finish-load', send);
}

function clearQuickAskHideTimer(): void {
  if (quickAskHideTimer) {
    clearTimeout(quickAskHideTimer);
    quickAskHideTimer = undefined;
  }
}

function clearQuickAskUnresponsiveTimer(): void {
  if (quickAskUnresponsiveTimer) {
    clearTimeout(quickAskUnresponsiveTimer);
    quickAskUnresponsiveTimer = undefined;
  }
}

function recoverQuickAskRenderer(window: BrowserWindow, reason: string): void {
  const wasVisible = !window.isDestroyed() && window.isVisible();
  isQuickAskRendererReady = false;
  clearQuickAskHideTimer();
  clearQuickAskUnresponsiveTimer();
  isQuickAskHiding = false;

  logWarn('quick-ask-renderer-recovery', { reason, wasVisible });

  if (!window.isDestroyed()) {
    window.destroy();
  }

  if (!wasVisible || isQuitting || !reserveAutomaticRecovery(quickAskRecoveryAttempts)) {
    return;
  }

  setTimeout(() => {
    if (!isQuitting && (!quickAskWindow || quickAskWindow.isDestroyed())) {
      showQuickAsk();
    }
  }, 300);
}

function showQuickAsk(): void {
  if (isShortcutCaptureActive) {
    return;
  }

  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const window = createQuickAskWindow();

  quickAskDisplayId = display.id;
  clearQuickAskHideTimer();
  isQuickAskHiding = false;
  window.setBounds(calculateQuickAskBounds(display), false);
  window.setAlwaysOnTop(true, popupAlwaysOnTopLevel);
  window.show();
  window.focus();
  window.moveTop();

  sendToQuickAsk('quickAsk:animate', 'in');
  sendToQuickAsk('settings:changed', settings);
}

function hideQuickAsk(): void {
  const window = quickAskWindow;

  if (!window || window.isDestroyed()) {
    clearQuickAskHideTimer();
    isQuickAskHiding = false;
    return;
  }

  if (isQuickAskHiding) {
    return;
  }

  clearQuickAskHideTimer();
  isQuickAskHiding = true;
  sendToQuickAsk('quickAsk:animate', 'out');

  quickAskHideTimer = setTimeout(() => {
    quickAskHideTimer = undefined;

    if (quickAskWindow !== window || !isQuickAskHiding) {
      return;
    }

    try {
      if (!window.isDestroyed()) {
        window.hide();
      }
    } catch (error) {
      console.warn('Could not hide the Quick Ask window cleanly.', error);
    } finally {
      if (quickAskWindow === window) {
        isQuickAskHiding = false;
      }
    }
  }, quickAskHideAnimationMs);
}

function toggleQuickAsk(): void {
  if (quickAskWindow?.isVisible() && !isQuickAskHiding) {
    hideQuickAsk();
    return;
  }

  showQuickAsk();
}

function submitQuickAsk(payload: QuickAskSubmitPayload): void {
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const providerId = typeof payload.providerId === 'string' ? payload.providerId : '';

  if (!prompt) {
    return;
  }

  if (!isQuickAskProvider(providerId)) {
    throw new Error('Quick Ask currently supports ChatGPT, Claude, and Gemini.');
  }

  const provider = settings.providers.find((item) => item.id === providerId);

  if (!provider) {
    throw new Error(`Provider "${providerId}" was not found.`);
  }

  if (settings.quickAsk.providerId !== provider.id) {
    settings = deepMergeSettings(settings, {
      quickAsk: {
        providerId: provider.id
      }
    });
    store.set(settings);
    broadcastSettings();
    sendToQuickAsk('settings:changed', settings);
  }

  currentProviderId = provider.id;
  broadcastProvider();
  hideQuickAsk();
  showPopup({ centerOnDisplayId: quickAskDisplayId });
  sendToPopup('quickAsk:submitted', {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    providerId: provider.id,
    prompt,
    targetUrl: getQuickAskTargetUrl(provider)
  });
}

function getQuickAskTargetUrl(provider: Provider): string {
  if (provider.id === 'chatgpt') {
    return 'https://chatgpt.com/';
  }

  if (provider.id === 'claude') {
    return 'https://claude.ai/new';
  }

  if (provider.id === 'gemini') {
    return 'https://gemini.google.com/app';
  }

  return provider.url;
}

function applyPopupSettings(options: PopupBoundsOptions = {}, skipOpacity = false): void {
  if (!popupWindow) {
    return;
  }

  popupWindow.setResizable(false);
  applyPopupTopMost({ moveToTop: popupWindow.isVisible() });
  popupWindow.setContentProtection(settings.privacy.captureProtection);
  popupWindow.setBounds(calculatePopupBounds(options), false);
}

function applyPopupTopMost(options: { moveToTop?: boolean } = {}): void {
  const window = popupWindow;

  if (!window || window.isDestroyed()) {
    return;
  }

  if (!settings.popup.alwaysOnTop) {
    stopPopupTopGuard();
    window.setAlwaysOnTop(false);
    return;
  }

  window.setAlwaysOnTop(true, popupAlwaysOnTopLevel);

  if (options.moveToTop && window.isVisible() && !isHiding && !isPopupMoving) {
    window.moveTop();
  }
}

function schedulePopupTopMostReassert(): void {
  clearPopupTopReassertTimers();

  if (!shouldKeepPopupOnTop()) {
    return;
  }

  for (const delay of popupTopReassertDelaysMs) {
    const timer = setTimeout(() => {
      if (shouldKeepPopupOnTop()) {
        applyPopupTopMost({ moveToTop: true });
      }
    }, delay);
    popupTopReassertTimers.push(timer);
  }

  startPopupTopGuard();
}

function shouldKeepPopupOnTop(): boolean {
  return Boolean(
    popupWindow &&
      !popupWindow.isDestroyed() &&
      popupWindow.isVisible() &&
      !isHiding &&
      !isPopupMoving &&
      settings.popup.alwaysOnTop
  );
}

function startPopupTopGuard(): void {
  if (popupTopGuardTimer || !shouldKeepPopupOnTop()) {
    return;
  }

  popupTopGuardTimer = setInterval(() => {
    if (!shouldKeepPopupOnTop()) {
      stopPopupTopGuard();
      return;
    }

    applyPopupTopMost({ moveToTop: true });
  }, popupTopGuardIntervalMs);
}

function stopPopupTopGuard(): void {
  if (popupTopGuardTimer) {
    clearInterval(popupTopGuardTimer);
    popupTopGuardTimer = undefined;
  }

  clearPopupTopReassertTimers();
}

function clearPopupTopReassertTimers(): void {
  for (const timer of popupTopReassertTimers) {
    clearTimeout(timer);
  }

  popupTopReassertTimers = [];
}

function markPopupMoving(): void {
  if (!popupWindow || popupWindow.isDestroyed() || isHiding) {
    return;
  }

  isPopupMoving = true;
  clearPopupTopReassertTimers();

  if (popupTopGuardTimer) {
    clearInterval(popupTopGuardTimer);
    popupTopGuardTimer = undefined;
  }

  if (popupMoveIdleTimer) {
    clearTimeout(popupMoveIdleTimer);
  }

  popupMoveIdleTimer = setTimeout(() => {
    popupMoveIdleTimer = undefined;
    isPopupMoving = false;
    normalizePopupSizeAfterMove();
    schedulePopupTopMostReassert();
  }, 220);
}

function resetPopupMoving(): void {
  if (popupMoveIdleTimer) {
    clearTimeout(popupMoveIdleTimer);
    popupMoveIdleTimer = undefined;
  }

  popupInteractiveMoveSession = undefined;
  isPopupMoving = false;
}

function normalizePopupSizeAfterMove(): void {
  if (!popupWindow || popupWindow.isDestroyed() || isPopupResizeInProgress) {
    return;
  }

  const bounds = popupWindow.getBounds();
  const expectedWidth = Math.round(settings.popup.width);
  const expectedHeight = Math.round(settings.popup.height);

  if (bounds.width === expectedWidth && bounds.height === expectedHeight) {
    return;
  }

  popupWindow.setBounds(
    {
      x: bounds.x,
      y: bounds.y,
      width: expectedWidth,
      height: expectedHeight
    },
    false
  );
}

function queuePopupPositionSave(): void {
  if (!settings.popup.rememberPosition || !popupWindow || popupWindow.isDestroyed()) {
    return;
  }

  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
  }

  savePositionTimer = setTimeout(() => {
    savePositionTimer = undefined;
    savePopupPosition();
  }, 250);
}

function savePopupPosition(position?: PopupPosition, shouldBroadcast = true): FloatAISettings {
  if (!settings.popup.rememberPosition) {
    return settings;
  }

  let bounds: Rectangle | undefined;

  if (!position && popupWindow && !popupWindow.isDestroyed()) {
    try {
      bounds = popupWindow.getBounds();
    } catch {
      bounds = undefined;
    }
  }

  const x = position?.x ?? bounds?.x;
  const y = position?.y ?? bounds?.y;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return settings;
  }

  if (settings.popup.x === x && settings.popup.y === y) {
    return settings;
  }

  settings = deepMergeSettings(settings, {
    popup: {
      x,
      y
    }
  });
  store.set(settings);
  if (shouldBroadcast) {
    broadcastSettings();
  }
  return settings;
}

function updateSettings(patch: DeepPartial<FloatAISettings>): FloatAISettings {
  const previousSettings = settings;
  const previousHotkey = settings.globalHotkey;
  const previousQuickAskHotkey = settings.quickAsk.hotkey;
  settings = deepMergeSettings(settings, patch);
  const globalHotkeyChanged = settings.globalHotkey !== previousHotkey;
  const quickAskHotkeyChanged = settings.quickAsk.hotkey !== previousQuickAskHotkey;

  if (!settings.providers.some((provider) => provider.id === currentProviderId)) {
    currentProviderId = settings.defaultProviderId;
  }

  if (patch.defaultProviderId) {
    currentProviderId = settings.defaultProviderId;
    broadcastProvider();
  }

  if (globalHotkeyChanged || quickAskHotkeyChanged) {
    const registered = registerGlobalShortcuts({ allowFallback: false });

    if (!registered) {
      settings = previousSettings;
      registerGlobalShortcuts({ allowFallback: true });
      const failedHotkey = globalHotkeyChanged ? patch.globalHotkey : patch.quickAsk?.hotkey;
      throw new Error(`Could not register shortcut "${failedHotkey}". It may be invalid or already in use.`);
    }
  }

  store.set(settings);
  syncLaunchAtStartup();
  syncTray();

  nativeTheme.themeSource = settings.darkMode ? 'dark' : 'light';

  applyPopupSettings();
  broadcastSettings();
  return settings;
}

function switchProvider(providerId: string): Provider {
  const provider = settings.providers.find((item) => item.id === providerId);

  if (!provider) {
    throw new Error(`Provider "${providerId}" was not found.`);
  }

  currentProviderId = provider.id;
  broadcastProvider();
  return provider;
}

function switchProviderFromShortcutInput(input: Electron.Input): boolean {
  if (
    !settings.enableProviderShortcuts ||
    input.type !== 'keyDown' ||
    input.isAutoRepeat ||
    input.isComposing ||
    !input.alt ||
    input.control ||
    input.meta ||
    input.shift
  ) {
    return false;
  }

  const providerIndex = providerIndexFromShortcutInput(input);

  if (providerIndex === null || providerIndex >= Math.min(settings.providers.length, 9)) {
    return false;
  }

  switchProvider(settings.providers[providerIndex].id);
  schedulePopupTopMostReassert();
  return true;
}

function providerIndexFromShortcutInput(input: Electron.Input): number | null {
  const digitByCode = input.code.match(/^(?:Digit|Numpad)([1-9])$/);

  if (digitByCode) {
    return Number(digitByCode[1]) - 1;
  }

  if (/^[1-9]$/.test(input.key)) {
    return Number(input.key) - 1;
  }

  return null;
}

async function pickProviderIcon(): Promise<ProviderIconPickResult | null> {
  const dialogOptions: Electron.OpenDialogOptions = {
    title: 'Choose provider icon',
    properties: ['openFile'],
    filters: [
      {
        name: 'Image Files',
        extensions: ['png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'gif', 'ico']
      }
    ]
  };
  const result = popupWindow
    ? await dialog.showOpenDialog(popupWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || !result.filePaths[0]) {
    return null;
  }

  const sourcePath = result.filePaths[0];
  const iconsDirectory = path.join(app.getPath('userData'), 'provider-icons');
  mkdirSync(iconsDirectory, { recursive: true });

  const fileName = `${Date.now()}-${sanitizeIconFileName(path.basename(sourcePath))}`;
  const destinationPath = path.join(iconsDirectory, fileName);
  copyFileSync(sourcePath, destinationPath);

  return {
    icon: `custom:${fileName}`,
    url: pathToFileURL(destinationPath).toString()
  };
}

async function getProviderIconFromUrl(rawProviderUrl: string): Promise<ProviderIconPickResult> {
  const providerUrl = normalizeWebsiteIconUrl(rawProviderUrl);
  const candidates = await getWebsiteIconCandidates(providerUrl);

  for (const candidate of candidates) {
    const downloadedIcon = await downloadWebsiteIcon(candidate.url, providerUrl.hostname);

    if (downloadedIcon) {
      return downloadedIcon;
    }
  }

  throw new Error('Could not find a website icon for that provider URL.');
}

function normalizeWebsiteIconUrl(value: string): URL {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    throw new Error('Provider URL is required before getting an icon.');
  }

  const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`);

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Use an http or https URL before getting an icon.');
  }

  return url;
}

async function getWebsiteIconCandidates(providerUrl: URL): Promise<WebsiteIconCandidate[]> {
  const candidates: WebsiteIconCandidate[] = [];

  try {
    const response = await net.fetch(providerUrl.toString());
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';

    if (response.ok && contentType.includes('text/html')) {
      candidates.push(...parseWebsiteIconCandidates(await response.text(), response.url || providerUrl.toString()));
    }
  } catch {
    // Fallback candidates below still cover most sites.
  }

  const origin = providerUrl.origin;
  candidates.push(
    { url: `https://www.google.com/s2/favicons?domain=${providerUrl.hostname}&sz=256`, score: 75 },
    { url: new URL('/favicon.ico', origin).toString(), score: 10 },
    { url: new URL('/favicon.png', origin).toString(), score: 8 },
    { url: new URL('/apple-touch-icon.png', origin).toString(), score: 6 }
  );

  return dedupeIconCandidates(candidates).sort((a, b) => b.score - a.score);
}

function parseWebsiteIconCandidates(html: string, baseUrl: string): WebsiteIconCandidate[] {
  const candidates: WebsiteIconCandidate[] = [];
  const linkMatches = html.matchAll(/<link\b[^>]*>/gi);

  for (const linkMatch of linkMatches) {
    const tag = linkMatch[0];
    const rel = getHtmlAttribute(tag, 'rel').toLowerCase();
    const href = getHtmlAttribute(tag, 'href');

    if (!href || !/\b(?:icon|apple-touch-icon|mask-icon)\b/i.test(rel) || href.trim().toLowerCase().startsWith('data:')) {
      continue;
    }

    try {
      candidates.push({
        url: new URL(href, baseUrl).toString(),
        score: getIconRelScore(rel) + getIconSizeScore(getHtmlAttribute(tag, 'sizes'))
      });
    } catch {
      // Ignore malformed icon URLs in provider pages.
    }
  }

  return candidates;
}

function getHtmlAttribute(tag: string, attributeName: string): string {
  const attributePattern = /([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  for (const match of tag.matchAll(attributePattern)) {
    if (match[1].toLowerCase() === attributeName) {
      return match[2] ?? match[3] ?? match[4] ?? '';
    }
  }

  return '';
}

function getIconRelScore(rel: string): number {
  if (rel.includes('apple-touch-icon')) {
    return 80;
  }

  if (rel.includes('shortcut icon')) {
    return 70;
  }

  if (rel.includes('icon')) {
    return 60;
  }

  return 30;
}

function getIconSizeScore(sizes: string): number {
  const iconSizes = Array.from(sizes.matchAll(/(\d+)x(\d+)/gi)).map((match) =>
    Math.max(Number(match[1]), Number(match[2]))
  );

  if (iconSizes.length === 0) {
    return 0;
  }

  return Math.min(Math.max(...iconSizes), 512) / 8;
}

function dedupeIconCandidates(candidates: WebsiteIconCandidate[]): WebsiteIconCandidate[] {
  const bestByUrl = new Map<string, WebsiteIconCandidate>();

  for (const candidate of candidates) {
    const existingCandidate = bestByUrl.get(candidate.url);

    if (!existingCandidate || candidate.score > existingCandidate.score) {
      bestByUrl.set(candidate.url, candidate);
    }
  }

  return Array.from(bestByUrl.values());
}

async function downloadWebsiteIcon(iconUrl: string, hostname: string): Promise<ProviderIconPickResult | null> {
  try {
    const response = await net.fetch(iconUrl);

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? '';
    const extension = getWebsiteIconExtension(iconUrl, contentType);

    if (!extension) {
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    if (buffer.length === 0 || buffer.length > 2 * 1024 * 1024) {
      return null;
    }

    const iconsDirectory = path.join(app.getPath('userData'), 'provider-icons');
    mkdirSync(iconsDirectory, { recursive: true });

    const cleanHost = sanitizeIconFileName(hostname.replace(/^www\./, '')) || 'provider';
    const fileName = `${Date.now()}-${cleanHost}-favicon.${extension}`;
    const destinationPath = path.join(iconsDirectory, fileName);
    writeFileSync(destinationPath, buffer);

    return {
      icon: `custom:${fileName}`,
      url: pathToFileURL(destinationPath).toString()
    };
  } catch {
    return null;
  }
}

function getWebsiteIconExtension(iconUrl: string, contentType: string): string | null {
  const extensionByContentType = new Map([
    ['image/png', 'png'],
    ['image/x-png', 'png'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/svg+xml', 'svg'],
    ['image/webp', 'webp'],
    ['image/avif', 'avif'],
    ['image/gif', 'gif'],
    ['image/vnd.microsoft.icon', 'ico'],
    ['image/x-icon', 'ico'],
    ['image/ico', 'ico']
  ]);
  const knownExtension = extensionByContentType.get(contentType);

  if (knownExtension) {
    return knownExtension;
  }

  if (contentType && !contentType.startsWith('image/')) {
    return null;
  }

  try {
    const extension = path.extname(new URL(iconUrl).pathname).slice(1).toLowerCase();
    return ['png', 'jpg', 'jpeg', 'svg', 'webp', 'avif', 'gif', 'ico'].includes(extension) ? extension : 'ico';
  } catch {
    return 'ico';
  }
}

function resolveProviderIcon(icon: string): string {
  const resolvedPath = resolveProviderIconPath(icon);
  return resolvedPath ? pathToFileURL(resolvedPath).toString() : '';
}

function resolveProviderIconPath(icon: string): string | null {
  const trimmedIcon = icon.trim();

  if (!trimmedIcon) {
    return null;
  }

  if (trimmedIcon.startsWith('custom:')) {
    const fileName = sanitizeIconFileName(trimmedIcon.slice('custom:'.length));
    const customPath = path.join(app.getPath('userData'), 'provider-icons', fileName);
    return existsSync(customPath) ? customPath : null;
  }

  if (path.isAbsolute(trimmedIcon)) {
    return existsSync(trimmedIcon) ? trimmedIcon : null;
  }

  const bundledIconPath = path.join(app.getAppPath(), 'provider-icons', `${sanitizeIconKey(trimmedIcon)}.png`);
  return existsSync(bundledIconPath) ? bundledIconPath : null;
}

function sanitizeIconKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function sanitizeIconFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

async function exportPortableBackup(): Promise<PortableBackupResult> {
  const backup = buildPortableBackup();
  const serializedBackup = `${JSON.stringify(backup, null, 2)}\n`;

  if (Buffer.byteLength(serializedBackup, 'utf8') > maxPortableBackupBytes) {
    throw new Error('Your local data is too large to export in one backup file.');
  }

  const defaultFileName = `Float-AI-Backup-${new Date().toISOString().slice(0, 10)}.${portableBackupExtension}`;
  const dialogOptions: Electron.SaveDialogOptions = {
    title: 'Export Float AI backup',
    defaultPath: defaultFileName,
    buttonLabel: 'Export Backup',
    filters: [{ name: 'Float AI Backup', extensions: ['json'] }]
  };
  const result =
    popupWindow && !popupWindow.isDestroyed()
      ? await dialog.showSaveDialog(popupWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  writeFileSync(result.filePath, serializedBackup, 'utf8');
  return {
    canceled: false,
    filePath: result.filePath,
    summary: summarizePortableBackup(backup)
  };
}

async function importPortableBackup(): Promise<PortableBackupResult> {
  const dialogOptions: Electron.OpenDialogOptions = {
    title: 'Import Float AI backup',
    buttonLabel: 'Choose Backup',
    properties: ['openFile'],
    filters: [{ name: 'Float AI Backup', extensions: ['json'] }]
  };
  const result =
    popupWindow && !popupWindow.isDestroyed()
      ? await dialog.showOpenDialog(popupWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  const filePath = result.filePaths[0];

  if (statSync(filePath).size > maxPortableBackupBytes) {
    throw new Error('That backup file is too large to import.');
  }

  let parsedBackup: unknown;

  try {
    parsedBackup = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    throw new Error('That file is not a valid Float AI backup.');
  }

  const backup = normalizePortableBackup(parsedBackup);
  const summary = summarizePortableBackup(backup);
  const details = [
    `${summary.providers} provider(s), ${summary.installedAddons} add-on(s), ${summary.scratchPadNotes} ScratchPad note(s), and ${summary.customProviderIcons} custom icon(s) will be restored.`,
    '',
    'This replaces your current Float AI settings and local add-on data.',
    'Login sessions are not included, so you will need to sign in again on this device.'
  ].join('\n');
  const confirmationOptions: Electron.MessageBoxOptions = {
    type: 'warning',
    title: 'Restore Float AI Backup',
    message: 'Replace current app data with this backup?',
    detail: details,
    buttons: ['Restore Backup', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    noLink: true
  };
  const confirmation =
    popupWindow && !popupWindow.isDestroyed()
      ? await dialog.showMessageBox(popupWindow, confirmationOptions)
      : await dialog.showMessageBox(confirmationOptions);

  if (confirmation.response !== 0) {
    return { canceled: true };
  }

  restorePortableProviderIcons(backup.data.providerIcons);
  const warnings: string[] = [];
  const previousHotkey = settings.globalHotkey;

  try {
    updateSettings(backup.data.settings);
  } catch {
    updateSettings({
      ...backup.data.settings,
      globalHotkey: previousHotkey
    });
    warnings.push('The backed-up shortcut is unavailable on this device, so your current shortcut was kept.');
  }

  restoreAddonState(backup.data.addons);
  restoreScratchPadState(backup.data.scratchPad);

  return {
    canceled: false,
    filePath,
    summary,
    ...(warnings.length > 0 ? { warnings } : {})
  };
}

function buildPortableBackup(): PortableBackupFile {
  return {
    format: portableBackupFormat,
    formatVersion: portableBackupVersion,
    appVersion: app.getVersion(),
    exportedAt: new Date().toISOString(),
    sourcePlatform: process.platform,
    includedData: {
      settings: true,
      providers: true,
      providerIcons: true,
      addons: true,
      scratchPad: true,
      loginSessions: false
    },
    data: {
      settings,
      addons: getAddonState(),
      scratchPad: { notes: getScratchPadNotes() },
      providerIcons: exportPortableProviderIcons()
    }
  };
}

function normalizePortableBackup(value: unknown): PortableBackupFile {
  if (!value || typeof value !== 'object') {
    throw new Error('That file is not a valid Float AI backup.');
  }

  const backup = value as Partial<PortableBackupFile>;

  if (backup.format !== portableBackupFormat || backup.formatVersion !== portableBackupVersion) {
    throw new Error('This backup format is not supported by this version of Float AI.');
  }

  if (!backup.data || typeof backup.data !== 'object') {
    throw new Error('That backup does not contain restorable app data.');
  }

  const data = backup.data as {
    settings?: unknown;
    addons?: unknown;
    scratchPad?: unknown;
    providerIcons?: unknown;
  };

  if (!data.settings || typeof data.settings !== 'object') {
    throw new Error('That backup does not contain valid settings.');
  }

  const restoredSettings = deepMergeSettings(platformDefaultSettings, data.settings as DeepPartial<FloatAISettings>);

  return {
    format: portableBackupFormat,
    formatVersion: portableBackupVersion,
    appVersion: typeof backup.appVersion === 'string' ? backup.appVersion : 'unknown',
    exportedAt: typeof backup.exportedAt === 'string' ? backup.exportedAt : '',
    sourcePlatform: typeof backup.sourcePlatform === 'string' ? backup.sourcePlatform : 'unknown',
    includedData: {
      settings: true,
      providers: true,
      providerIcons: true,
      addons: true,
      scratchPad: true,
      loginSessions: false
    },
    data: {
      settings: restoredSettings,
      addons: normalizeAddonStorageState(data.addons),
      scratchPad: normalizeScratchPadStorageState(data.scratchPad),
      providerIcons: normalizePortableProviderIcons(data.providerIcons, restoredSettings.providers)
    }
  };
}

function exportPortableProviderIcons(): Record<string, PortableProviderIcon> {
  const providerIcons: Record<string, PortableProviderIcon> = {};
  const iconsDirectory = path.join(app.getPath('userData'), 'provider-icons');
  let totalBytes = 0;

  for (const provider of settings.providers) {
    const fileName = getSafeCustomIconFileName(provider.icon);

    if (!fileName || providerIcons[provider.icon]) {
      continue;
    }

    const iconPath = path.join(iconsDirectory, fileName);

    try {
      const iconStat = lstatSync(iconPath);

      if (
        !iconStat.isFile() ||
        iconStat.size === 0 ||
        iconStat.size > maxPortableIconBytes ||
        totalBytes + iconStat.size > maxPortableBackupBytes / 2
      ) {
        continue;
      }

      totalBytes += iconStat.size;
      providerIcons[provider.icon] = {
        fileName,
        dataBase64: readFileSync(iconPath).toString('base64')
      };
    } catch {
      // Missing custom icon files do not make the rest of a backup unusable.
    }
  }

  return providerIcons;
}

function normalizePortableProviderIcons(value: unknown, providers: Provider[]): Record<string, PortableProviderIcon> {
  const input = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const providerIcons: Record<string, PortableProviderIcon> = {};
  const referencedIconKeys = new Set(providers.map((provider) => provider.icon));
  let totalBytes = 0;

  for (const iconKey of referencedIconKeys) {
    const fileName = getSafeCustomIconFileName(iconKey);
    const iconValue = input[iconKey];

    if (!fileName || !iconValue || typeof iconValue !== 'object') {
      continue;
    }

    const icon = iconValue as Partial<PortableProviderIcon>;

    if (
      icon.fileName !== fileName ||
      typeof icon.dataBase64 !== 'string' ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(icon.dataBase64)
    ) {
      continue;
    }

    const data = Buffer.from(icon.dataBase64, 'base64');

    if (
      data.byteLength === 0 ||
      data.byteLength > maxPortableIconBytes ||
      totalBytes + data.byteLength > maxPortableBackupBytes
    ) {
      continue;
    }

    totalBytes += data.byteLength;
    providerIcons[iconKey] = {
      fileName,
      dataBase64: data.toString('base64')
    };
  }

  return providerIcons;
}

function restorePortableProviderIcons(providerIcons: Record<string, PortableProviderIcon>): void {
  const iconsDirectory = path.join(app.getPath('userData'), 'provider-icons');
  mkdirSync(iconsDirectory, { recursive: true });

  for (const icon of Object.values(providerIcons)) {
    writeFileSync(path.join(iconsDirectory, icon.fileName), Buffer.from(icon.dataBase64, 'base64'));
  }
}

function getSafeCustomIconFileName(iconKey: string): string | null {
  if (!iconKey.startsWith('custom:')) {
    return null;
  }

  const fileName = iconKey.slice('custom:'.length);

  if (
    !fileName ||
    fileName === '.' ||
    fileName === '..' ||
    path.posix.basename(fileName) !== fileName ||
    path.win32.basename(fileName) !== fileName ||
    sanitizeIconFileName(fileName) !== fileName
  ) {
    return null;
  }

  return fileName;
}

function summarizePortableBackup(backup: PortableBackupFile): PortableBackupSummary {
  return {
    providers: backup.data.settings.providers.length,
    customProviderIcons: Object.keys(backup.data.providerIcons).length,
    installedAddons: Object.keys(backup.data.addons.installedAddons).length,
    scratchPadNotes: backup.data.scratchPad.notes.length
  };
}

function resizePopup(size: PopupSize): FloatAISettings {
  return updateSettings({
    popup: {
      width: size.width,
      height: size.height
    }
  });
}

function getExpectedPopupBoundsAt(x: number, y: number): Rectangle {
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(settings.popup.width),
    height: Math.round(settings.popup.height)
  };
}

function beginPopupMoveInteractive(): void {
  if (!popupWindow || popupWindow.isDestroyed()) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const bounds = popupWindow.getBounds();
  const startBounds = getExpectedPopupBoundsAt(bounds.x, bounds.y);

  popupInteractiveMoveSession = {
    startCursorX: cursorPoint.x,
    startCursorY: cursorPoint.y,
    startBounds
  };

  markPopupMoving();

  if (bounds.width !== startBounds.width || bounds.height !== startBounds.height) {
    popupWindow.setBounds(startBounds, false);
  }
}

function movePopupInteractive(): void {
  if (!popupWindow || popupWindow.isDestroyed()) {
    return;
  }

  if (!popupInteractiveMoveSession) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const nextBounds = getExpectedPopupBoundsAt(
    popupInteractiveMoveSession.startBounds.x + cursorPoint.x - popupInteractiveMoveSession.startCursorX,
    popupInteractiveMoveSession.startBounds.y + cursorPoint.y - popupInteractiveMoveSession.startCursorY
  );

  markPopupMoving();
  popupWindow.setBounds(nextBounds, false);
}

function endPopupMoveInteractive(shouldSavePosition: boolean): FloatAISettings | undefined {
  popupInteractiveMoveSession = undefined;
  normalizePopupSizeAfterMove();
  resetPopupMoving();
  schedulePopupTopMostReassert();

  if (shouldSavePosition) {
    return savePopupPosition();
  }

  return undefined;
}

function broadcastSettings(): void {
  sendToPopup('settings:changed', settings);
  sendToQuickAsk('settings:changed', settings);
}

function broadcastProvider(): void {
  sendToPopup('provider:changed', getSelectedProvider());
}

function registerGlobalShortcuts(options: { allowFallback?: boolean } = {}): boolean {
  unregisterRegisteredGlobalShortcuts();

  registeredHotkey = registerShortcutFromCandidates(
    [
      settings.globalHotkey,
      ...(isMac && options.allowFallback ? [macDefaultHotkey, 'CommandOrControl+Shift+Space'] : [])
    ],
    () => {
      if (!isShortcutCaptureActive) {
        togglePopup({ anchorToCursor: true });
      }
    },
    'popup'
  );

  registeredQuickAskHotkey = registerShortcutFromCandidates(
    [
      settings.quickAsk.hotkey,
      ...(options.allowFallback ? [quickAskDefaultHotkey, 'CommandOrControl+Shift+K'] : [])
    ],
    () => {
      if (!isShortcutCaptureActive) {
        toggleQuickAsk();
      }
    },
    'Quick Ask'
  );

  if (isMac && app.isReady()) {
    setupApplicationMenu();
  }

  return Boolean(registeredHotkey && registeredQuickAskHotkey);
}

function unregisterRegisteredGlobalShortcuts(): void {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }

  if (registeredQuickAskHotkey) {
    globalShortcut.unregister(registeredQuickAskHotkey);
    registeredQuickAskHotkey = null;
  }
}

function registerShortcutFromCandidates(
  candidates: string[],
  callback: () => void,
  label: string
): string | null {
  const preferredHotkeys = candidates.filter((hotkey, index, hotkeys) => hotkey && hotkeys.indexOf(hotkey) === index);

  for (const hotkey of preferredHotkeys) {
    let ok = false;

    try {
      ok = globalShortcut.register(hotkey, callback);
    } catch {
      ok = false;
    }

    if (ok) {
      return hotkey;
    }
  }

  console.warn(`Could not register ${label} shortcut: ${preferredHotkeys.join(', ')}`);
  return null;
}

function setShortcutCaptureActive(active: boolean): void {
  if (isShortcutCaptureActive === active) {
    return;
  }

  isShortcutCaptureActive = active;

  if (active) {
    unregisterRegisteredGlobalShortcuts();
    return;
  }

  registerGlobalShortcuts({ allowFallback: true });
}

function syncLaunchAtStartup(): void {
  if (isMac && isDev) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      path: process.execPath
    });
  } catch (error) {
    console.warn('Could not update launch-at-login settings.', error);
  }
}

function createTrayImage(): Electron.NativeImage {
  const iconPath = getTrayIconPath();
  if (existsSync(iconPath)) {
    const image = nativeImage.createFromPath(iconPath);
    const resizedImage = image.resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
    resizedImage.setTemplateImage(isMac);
    return resizedImage;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="8" fill="#101214"/>
      <path d="M8 22V10h16v3H12v2.5h10V18H12v4H8z" fill="#e9eef2"/>
      <circle cx="24" cy="22" r="4" fill="#52d273"/>
    </svg>
  `;

  const image = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  const resizedImage = image.resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
  resizedImage.setTemplateImage(isMac);
  return resizedImage;
}

function openDiagnosticsFolder(): void {
  const diagnosticsPath = getDiagnosticsDirectory();
  void shell.openPath(diagnosticsPath).then((errorMessage) => {
    if (errorMessage) {
      logWarn('open-diagnostics-folder-failed', { errorMessage });
      return;
    }

    logInfo('diagnostics-folder-opened');
  });
}

function createTrayMenu(): Menu {
  const canHide = Boolean(popupWindow?.isVisible() && !isHiding);

  return Menu.buildFromTemplate([
    {
      label: canHide ? 'Hide Popup' : 'Open Popup',
      click: () => togglePopup()
    },
    {
      label: 'Open Settings',
      click: openIntegratedSettings
    },
    { type: 'separator' },
    {
      label: 'Privacy Capture Protection',
      type: 'checkbox',
      checked: settings.privacy?.captureProtection ?? false,
      click: (menuItem) => {
        updateSettings({ privacy: { captureProtection: menuItem.checked } });
      }
    },
    { type: 'separator' },
    {
      label: 'Refresh Pages',
      click: () => reloadAllWebviews()
    },
    {
      label: 'Open Diagnostics Folder',
      click: openDiagnosticsFolder
    },
    { type: 'separator' },
    {
      label: isMac ? `Quit ${appDisplayName} Completely` : 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function updateTrayAppearance(): void {
  if (!tray) {
    return;
  }

  tray.setImage(createTrayImage());
  tray.setToolTip(appDisplayName);

  if (isMac) {
    tray.setTitle('');
    tray.setIgnoreDoubleClickEvents(true);
  }
}

function syncMacDockVisibility(): void {
  if (!isMac || !app.isReady()) {
    return;
  }

  if (settings.showTrayIcon) {
    app.dock?.hide();
    return;
  }

  const showDock = app.dock?.show();
  showDock?.catch((error) => {
    console.warn('Could not show the Dock icon after hiding the menu bar icon.', error);
  });
}

function syncTray(): void {
  syncMacDockVisibility();

  if (!settings.showTrayIcon) {
    tray?.destroy();
    tray = null;
    return;
  }

  if (!tray) {
    tray = new Tray(createTrayImage());
    tray.on('click', () => togglePopup());
  }

  updateTrayAppearance();
  tray.setContextMenu(createTrayMenu());
}

function setupApplicationMenu(): void {
  if (!isMac) {
    return;
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          {
            label: `Quit ${appDisplayName} Completely`,
            accelerator: 'Command+Q',
            click: () => {
              isQuitting = true;
              app.quit();
            }
          }
        ]
      },
      {
        label: appDisplayName,
        submenu: [
          {
            label: 'Open Popup',
            accelerator: registeredHotkey ?? settings.globalHotkey,
            click: () => showPopup({ anchorToCursor: true })
          },
          {
            label: 'Quick Ask',
            accelerator: registeredQuickAskHotkey ?? settings.quickAsk.hotkey,
            click: () => showQuickAsk()
          },
          {
            label: 'Open Settings',
            accelerator: 'Command+,',
            click: openIntegratedSettings
          },
          { type: 'separator' },
          {
            label: 'Refresh Pages',
            accelerator: 'Command+R',
            click: reloadAllWebviews
          },
          {
            label: 'Open Diagnostics Folder',
            click: openDiagnosticsFolder
          }
        ]
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' }
        ]
      }
    ])
  );
}

function reloadAllWebviews(): void {
  sendToPopup('webview:reloadAll');
}

function waitForNetworkAndReload(): void {
  const maxAttempts = 30;
  let attempts = 0;

  const check = () => {
    attempts += 1;

    if (net.isOnline()) {
      // Small extra delay to let DNS / services stabilise after the NIC comes up.
      setTimeout(() => reloadAllWebviews(), 2000);
      return;
    }

    if (attempts < maxAttempts) {
      setTimeout(check, 2000);
    }
  };

  // Begin polling after a short initial delay to give the renderer time to mount.
  setTimeout(check, 3000);
}

function registerIpc(): void {
  ipcMain.on('diagnostics:rendererError', (event, report: unknown) => {
    if (!report || typeof report !== 'object') {
      return;
    }

    const candidate = report as Record<string, unknown>;
    if (typeof candidate.message !== 'string') {
      return;
    }

    const popupContents = getUsableWebContents(popupWindow);
    const quickAskContents = getUsableWebContents(quickAskWindow);
    const source =
      event.sender === popupContents
        ? 'popup'
        : event.sender === quickAskContents
          ? 'quick-ask'
          : 'unknown-renderer';

    logWarn('renderer-error-report', {
      source,
      kind: typeof candidate.kind === 'string' ? candidate.kind : 'unknown',
      message: candidate.message,
      stack: typeof candidate.stack === 'string' ? candidate.stack : undefined,
      componentStack: typeof candidate.componentStack === 'string' ? candidate.componentStack : undefined
    });
  });
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:update', (_event, patch: DeepPartial<FloatAISettings>) => updateSettings(patch));
  ipcMain.handle('window:openSettings', () => openIntegratedSettings());
  ipcMain.handle('popup:toggle', () => togglePopup());
  ipcMain.handle('popup:hide', () => hidePopup());
  ipcMain.handle('quickAsk:hide', () => hideQuickAsk());
  ipcMain.handle('quickAsk:submit', (_event, payload: QuickAskSubmitPayload) => submitQuickAsk(payload));
  ipcMain.handle('shortcut:captureActive', (_event, active: boolean) => setShortcutCaptureActive(Boolean(active)));
  ipcMain.handle('provider:switch', (_event, providerId: string) => switchProvider(providerId));
  ipcMain.handle('provider:pickIcon', () => pickProviderIcon());
  ipcMain.handle('provider:getIconFromUrl', (_event, url: string) => getProviderIconFromUrl(url));
  ipcMain.handle('provider:resolveIcon', (_event, icon: string) => resolveProviderIcon(icon));
  ipcMain.handle('popup:resize', (_event, size: PopupSize) => resizePopup(size));
  ipcMain.handle('popup:resizeInteractive', (_event, size: PopupSize) => {
    if (popupWindow && !popupWindow.isDestroyed()) {
      const bounds = popupWindow.getBounds();
      isPopupResizeInProgress = true;
      try {
        popupWindow.setBounds({ ...bounds, width: Math.round(size.width), height: Math.round(size.height) }, false);
      } finally {
        isPopupResizeInProgress = false;
      }
    }
  });
  ipcMain.handle('popup:beginMoveInteractive', () => beginPopupMoveInteractive());
  ipcMain.handle('popup:moveInteractive', () => movePopupInteractive());
  ipcMain.handle('popup:endMoveInteractive', (_event, savePosition: boolean) =>
    endPopupMoveInteractive(Boolean(savePosition))
  );
  ipcMain.handle('popup:savePosition', (_event, position?: PopupPosition) => savePopupPosition(position));
  ipcMain.handle('webview:reloadAll', () => reloadAllWebviews());
  ipcMain.handle('addons:getState', () => getAddonState());
  ipcMain.handle('addons:install', (_event, addonId: string) => installAddon(addonId));
  ipcMain.handle('addons:uninstall', (_event, addonId: string) => uninstallAddon(addonId));
  ipcMain.handle('addons:getDownloads', () => getAddonDownloads());
  ipcMain.handle('scratchpad:getNotes', () => getScratchPadNotes());
  ipcMain.handle('scratchpad:createNote', () => createScratchPadNote());
  ipcMain.handle('scratchpad:updateNote', (_event, noteId: string, patch: ScratchPadNotePatch) =>
    updateScratchPadNote(noteId, patch)
  );
  ipcMain.handle('scratchpad:deleteNote', (_event, noteId: string) => deleteScratchPadNote(noteId));
  ipcMain.handle('clipboard:writeText', (_event, text: string) => {
    clipboard.writeText(text);
  });
  ipcMain.handle('backup:export', () => exportPortableBackup());
  ipcMain.handle('backup:import', () => importPortableBackup());
}

if (gotLock) {
  registerIpc();
}

app.on('second-instance', () => {
  logInfo('second-instance-requested');
  showPopup();
});

app.on('child-process-gone', (_event, details) => {
  logWarn('child-process-gone', details);
});

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    attachProviderWebContentsDiagnostics(contents);
    const webContentsId = contents.id;
    const sendProviderAudioState = (audible: boolean) => {
      const state: ProviderAudioState = { webContentsId, audible };
      sendToPopup('provider:audioStateChanged', state);
    };

    contents.on('audio-state-changed', (event) => {
      sendProviderAudioState(event.audible);
    });

    contents.once('destroyed', () => {
      sendProviderAudioState(false);
    });

    contents.setWindowOpenHandler(({ url }) => {
      if (!isAllowedProviderPopupUrl(url)) {
        openExternalUrl(url);
        return { action: 'deny' };
      }

      return {
        action: 'allow',
        overrideBrowserWindowOptions: providerPopupWindowOptions()
      };
    });

    contents.on('did-create-window', (window) => {
      configureProviderPopupWindow(window);
    });

    contents.on('before-input-event', (event, input) => {
      if (switchProviderFromShortcutInput(input)) {
        event.preventDefault();
        return;
      }

      if (!settings.enableZoomShortcuts || input.type !== 'keyDown') return;

      const isZoomIn = (input.control || input.meta) && (input.key === '=' || input.key === '+');
      const isZoomOut = (input.control || input.meta) && input.key === '-';
      const isZoomReset = (input.control || input.meta) && input.key === '0';

      if (isZoomIn) {
        contents.setZoomLevel(contents.getZoomLevel() + 0.5);
        event.preventDefault();
      } else if (isZoomOut) {
        contents.setZoomLevel(contents.getZoomLevel() - 0.5);
        event.preventDefault();
      } else if (isZoomReset) {
        contents.setZoomLevel(0);
        event.preventDefault();
      }
    });

    const appCommandContents = contents as unknown as {
      on: (event: 'app-command', listener: (event: unknown, command: string) => void) => void;
    };

    appCommandContents.on('app-command', (_appCommandEvent, command) => {
      if (command === 'browser-backward' && contents.canGoBack()) {
        contents.goBack();
        clearGuestSelection(contents);
      }

      if (command === 'browser-forward' && contents.canGoForward()) {
        contents.goForward();
        clearGuestSelection(contents);
      }
    });

    contents.on('dom-ready', () => {
      contents
        .executeJavaScript(
          `
            (() => {
              if (window.__floataiMouseNavigationGuard) return;
              window.__floataiMouseNavigationGuard = true;
              const clearSelection = () => {
                const selection = window.getSelection && window.getSelection();
                if (selection && selection.removeAllRanges) selection.removeAllRanges();
              };
              window.addEventListener('mouseup', (event) => {
                if (event.button === 3 || event.button === 4) {
                  event.preventDefault();
                  clearSelection();
                  if (event.button === 3) window.history.back();
                  if (event.button === 4) window.history.forward();
                }
              }, true);
            })();
          `,
          true
        )
        .catch(() => undefined);
    });
  }
});

function clearGuestSelection(contents: Electron.WebContents): void {
  contents
    .executeJavaScript(
      `
        (() => {
          const selection = window.getSelection && window.getSelection();
          if (selection && selection.removeAllRanges) selection.removeAllRanges();
        })();
      `,
      true
    )
    .catch(() => undefined);
}

function startResourceMonitor(): void {
  stopResourceMonitor();
  collectResourceSnapshot('startup');
  resourceMonitorTimer = setInterval(() => collectResourceSnapshot('interval'), resourceMonitorIntervalMs);
  resourceMonitorTimer.unref();
}

function stopResourceMonitor(): void {
  if (resourceMonitorTimer) {
    clearInterval(resourceMonitorTimer);
    resourceMonitorTimer = undefined;
  }
}

function collectResourceSnapshot(reason: 'startup' | 'interval' | 'shutdown'): void {
  try {
    const processes = app
      .getAppMetrics()
      .map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        name: metric.name,
        privateBytesKb: metric.memory.privateBytes ?? metric.memory.workingSetSize,
        workingSetKb: metric.memory.workingSetSize,
        cpuPercent: Math.round(metric.cpu.percentCPUUsage * 10) / 10
      }))
      .sort((left, right) => right.privateBytesKb - left.privateBytesKb);
    const totalPrivateBytesKb = processes.reduce((total, metric) => total + metric.privateBytesKb, 0);
    const totalWorkingSetKb = processes.reduce((total, metric) => total + metric.workingSetKb, 0);

    logInfo('resource-snapshot', {
      reason,
      processCount: processes.length,
      totalPrivateMb: Math.round(totalPrivateBytesKb / 1024),
      totalWorkingSetMb: Math.round(totalWorkingSetKb / 1024),
      processes: processes.map((metric) => ({
        ...metric,
        privateBytesKb: undefined,
        workingSetKb: undefined,
        privateMb: Math.round(metric.privateBytesKb / 1024),
        workingSetMb: Math.round(metric.workingSetKb / 1024)
      }))
    });

    if (
      totalPrivateBytesKb >= highMemoryPrivateBytesKb &&
      Date.now() - lastMemoryPressureAt >= memoryPressureCooldownMs
    ) {
      lastMemoryPressureAt = Date.now();
      const includeSelected = !popupWindow || popupWindow.isDestroyed() || !popupWindow.isVisible();
      logWarn('high-memory-pressure', {
        totalPrivateMb: Math.round(totalPrivateBytesKb / 1024),
        includeSelected
      });
      sendToPopup('memory:pressure', { includeSelected });
    }
  } catch (error) {
    logError('resource-snapshot-failed', error, { reason });
  }
}

app.whenReady().then(() => {
  if (!gotLock) {
    app.exit(0);
    return;
  }

  app.userAgentFallback = app.userAgentFallback.replace(/Electron\/[\d.]+ /, '');

  settings = deepMergeSettings(platformDefaultSettings, store.store as DeepPartial<FloatAISettings>);
  store.set(settings);
  
  nativeTheme.themeSource = settings.darkMode ? 'dark' : 'light';

  setupApplicationMenu();
  syncLaunchAtStartup();
  syncTray();
  registerGlobalShortcuts({ allowFallback: true });
  startResourceMonitor();
  logInfo('app-ready', {
    providerCount: settings.providers.length,
    alwaysActiveProviderCount: settings.providers.filter((provider) => provider.alwaysActive).length,
    memorySaverEnabled: settings.performance.memorySaver,
    memorySaverUnloadMinutes: settings.performance.memorySaverUnloadMinutes,
    hardwareAccelerationEnabled: settings.performance.hardwareAcceleration
  });

  if (!app.isPackaged && process.env.FLOAT_AI_TEST_RENDERER_RECOVERY === '1') {
    runRendererRecoverySmokeTest();
  }

  // When the app launches at startup the network may not be ready yet,
  // causing webviews to show blank pages.  Poll for connectivity and
  // trigger a reload once the network comes up.
  if (settings.launchAtStartup && !net.isOnline()) {
    waitForNetworkAndReload();
  }
});

app.on('before-quit', () => {
  if (!gotLock) {
    return;
  }

  isQuitting = true;
  collectResourceSnapshot('shutdown');
  stopResourceMonitor();
  clearPopupHideTimer();
  clearQuickAskHideTimer();
  clearPopupUnresponsiveTimer();
  clearQuickAskUnresponsiveTimer();
  for (const timer of webviewUnresponsiveTimers.values()) {
    clearTimeout(timer);
  }
  webviewUnresponsiveTimers.clear();
  try {
    savePopupPosition();
  } catch (error) {
    console.warn('Could not save the popup position while quitting.', error);
  }
});

function attachProviderWebContentsDiagnostics(contents: Electron.WebContents): void {
  const webContentsId = contents.id;

  const clearUnresponsiveTimer = () => {
    const timer = webviewUnresponsiveTimers.get(webContentsId);
    if (timer) {
      clearTimeout(timer);
      webviewUnresponsiveTimers.delete(webContentsId);
    }
  };

  contents.on('unresponsive', () => {
    if (contents.isDestroyed()) {
      return;
    }

    logWarn('provider-webview-unresponsive', { webContentsId });
    clearUnresponsiveTimer();

    const timer = setTimeout(() => {
      webviewUnresponsiveTimers.delete(webContentsId);

      if (contents.isDestroyed()) {
        return;
      }

      logWarn('provider-webview-force-recovery', { webContentsId });
      contents.forcefullyCrashRenderer();
    }, providerUnresponsiveRecoveryMs);

    webviewUnresponsiveTimers.set(webContentsId, timer);
  });

  contents.on('responsive', () => {
    logInfo('provider-webview-responsive', { webContentsId });
    clearUnresponsiveTimer();
  });

  contents.on('render-process-gone', (_event, details) => {
    clearUnresponsiveTimer();
    logWarn('provider-webview-render-process-gone', {
      webContentsId,
      reason: details.reason,
      exitCode: details.exitCode
    });
  });

  contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      logWarn('provider-webview-load-failed', { webContentsId, errorCode, errorDescription });
    }
  });

  contents.once('destroyed', () => {
    clearUnresponsiveTimer();
    logInfo('provider-webview-destroyed', { webContentsId });
  });
}

app.on('will-quit', () => {
  if (!gotLock) {
    return;
  }

  logInfo('app-will-quit');
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  if (gotLock) {
    showPopup();
  }
});

app.on('window-all-closed', () => {
  // Keep the app resident so the global shortcut and tray can reopen the popup.
});
