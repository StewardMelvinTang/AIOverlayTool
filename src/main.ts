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
  type Rectangle
} from 'electron';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Store from 'electron-store';
import {
  deepMergeSettings,
  defaultSettings,
  type DeepPartial,
  type FloatAISettings,
  type Provider
} from './shared/settings';
import type { ProviderIconPickResult, PopupPosition, PopupSize } from './shared/bridge';
import type { ScratchPadNotePatch } from './shared/addons';
import {
  getAddonDownloads,
  getAddonState,
  installAddon,
  uninstallAddon
} from './main/addonStorage';
import {
  createScratchPadNote,
  deleteScratchPadNote,
  getScratchPadNotes,
  updateScratchPadNote
} from './main/scratchPadStorage';

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const appDisplayName = 'Float AI';
const appUserModelId = 'com.floatai.launcher';
const macDefaultHotkey = 'Option+Space';
const store = new Store<FloatAISettings>({
  name: 'float-ai-launcher',
  defaults: defaultSettings
});

let settings = applyPlatformSettings(deepMergeSettings(defaultSettings, store.store as DeepPartial<FloatAISettings>));
let popupWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let registeredHotkey: string | null = null;
let currentProviderId = settings.defaultProviderId;
let savePositionTimer: NodeJS.Timeout | undefined;
let isPopupRendererReady = false;
let isQuitting = false;
let isHiding = false;
let isShortcutCaptureActive = false;
let popupTopGuardTimer: NodeJS.Timeout | undefined;
let popupTopReassertTimers: NodeJS.Timeout[] = [];
let popupMoveIdleTimer: NodeJS.Timeout | undefined;
let isPopupMoving = false;
let isPopupResizeInProgress = false;


type PopupBoundsOptions = {
  anchorToCursor?: boolean;
};

type WebsiteIconCandidate = {
  url: string;
  score: number;
};

type AlwaysOnTopLevel = NonNullable<Parameters<BrowserWindow['setAlwaysOnTop']>[1]>;

const popupAlwaysOnTopLevel: AlwaysOnTopLevel = isWindows ? 'screen-saver' : 'floating';
const popupTopGuardIntervalMs = 900;
const popupTopReassertDelaysMs = [0, 80, 240];

if (!settings.performance.hardwareAcceleration) {
  app.disableHardwareAcceleration();
}

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

process.title = appDisplayName;
app.setName(appDisplayName);

if (isWindows) {
  app.setAppUserModelId(appUserModelId);
}

function applyPlatformSettings(nextSettings: FloatAISettings): FloatAISettings {
  if (!isMac) {
    return nextSettings;
  }

  const patch: DeepPartial<FloatAISettings> = {};

  if (nextSettings.globalHotkey === defaultSettings.globalHotkey) {
    patch.globalHotkey = macDefaultHotkey;
  }

  if (!nextSettings.showTrayIcon) {
    patch.showTrayIcon = true;
  }

  return Object.keys(patch).length > 0 ? deepMergeSettings(nextSettings, patch) : nextSettings;
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

function getRendererUrl(windowName: 'popup' | 'settings'): string {
  if (isDev) {
    const baseUrl = process.env.VITE_DEV_SERVER_URL ?? 'http://127.0.0.1:5173';
    return `${baseUrl}?window=${windowName}`;
  }

  return path.join(__dirname, '../dist-renderer/index.html');
}

function loadRenderer(window: BrowserWindow, windowName: 'popup' | 'settings'): void {
  if (isDev) {
    window.loadURL(getRendererUrl(windowName));
    return;
  }

  window.loadFile(getRendererUrl(windowName), {
    query: {
      window: windowName
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createPopupWindow(): BrowserWindow {
  if (popupWindow) {
    return popupWindow;
  }

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
    stopPopupTopGuard();
    resetPopupMoving();
    setShortcutCaptureActive(false);
    popupWindow = null;
    isPopupRendererReady = false;
  });

  popupWindow.webContents.once('did-finish-load', () => {
    isPopupRendererReady = true;
    broadcastSettings();
    broadcastProvider();
  });

  popupWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') {
      popupWindow?.webContents.send('webview:navigate', 'back');
    }

    if (command === 'browser-forward') {
      popupWindow?.webContents.send('webview:navigate', 'forward');
    }
  });

  popupWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  popupWindow.webContents.on('context-menu', (event) => {
    event.preventDefault();
  });

  popupWindow.webContents.on('before-input-event', (event, input) => {
    if (switchProviderFromShortcutInput(input)) {
      event.preventDefault();
    }
  });

  loadRenderer(popupWindow, 'popup');
  return popupWindow;
}

function sendToPopup(channel: string, ...args: unknown[]): void {
  const window = popupWindow;

  if (!window || window.isDestroyed()) {
    return;
  }

  const send = () => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  };

  if (isPopupRendererReady) {
    send();
    return;
  }

  window.webContents.once('did-finish-load', send);
}

function showPopup(options: PopupBoundsOptions = {}): void {
  const window = createPopupWindow();
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
  if (!popupWindow || isHiding) {
    return;
  }

  resetPopupMoving();
  isHiding = true;
  savePopupPosition();
  sendToPopup('popup:animate', 'out');
  
  setTimeout(() => {
    if (popupWindow && !popupWindow.isDestroyed() && isHiding) {
      popupWindow.hide();
      isHiding = false;
      stopPopupTopGuard();
      syncTray();
    }
  }, 120);
}

function togglePopup(options: PopupBoundsOptions = {}): void {
  if (isShortcutCaptureActive) {
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
      ...bounds,
      width: expectedWidth,
      height: expectedHeight
    },
    false
  );
}

function queuePopupPositionSave(): void {
  if (!settings.popup.rememberPosition || !popupWindow) {
    return;
  }

  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
  }

  savePositionTimer = setTimeout(() => {
    savePopupPosition();
  }, 250);
}

function savePopupPosition(position?: PopupPosition): FloatAISettings {
  if (!settings.popup.rememberPosition) {
    return settings;
  }

  const bounds = popupWindow?.getBounds();
  const x = position?.x ?? bounds?.x;
  const y = position?.y ?? bounds?.y;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return settings;
  }

  settings = deepMergeSettings(settings, {
    popup: {
      x,
      y
    }
  });
  store.set(settings);
  broadcastSettings();
  return settings;
}

function updateSettings(patch: DeepPartial<FloatAISettings>): FloatAISettings {
  const previousSettings = settings;
  const previousHotkey = settings.globalHotkey;
  settings = applyPlatformSettings(deepMergeSettings(settings, patch));

  if (!settings.providers.some((provider) => provider.id === currentProviderId)) {
    currentProviderId = settings.defaultProviderId;
  }

  if (patch.defaultProviderId) {
    currentProviderId = settings.defaultProviderId;
    broadcastProvider();
  }

  if (settings.globalHotkey !== previousHotkey) {
    const registered = registerGlobalShortcut({ allowFallback: false });

    if (!registered) {
      settings = previousSettings;
      registerGlobalShortcut({ allowFallback: true });
      throw new Error(`Could not register global shortcut "${patch.globalHotkey}". It may be invalid or already in use.`);
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

function resizePopup(size: PopupSize): FloatAISettings {
  return updateSettings({
    popup: {
      width: size.width,
      height: size.height
    }
  });
}

function broadcastSettings(): void {
  sendToPopup('settings:changed', settings);
}

function broadcastProvider(): void {
  sendToPopup('provider:changed', getSelectedProvider());
}

function registerGlobalShortcut(options: { allowFallback?: boolean } = {}): string | null {
  if (registeredHotkey) {
    globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
  }

  const preferredHotkeys = [
    settings.globalHotkey,
    ...(isMac && options.allowFallback ? [macDefaultHotkey, 'CommandOrControl+Shift+Space'] : [])
  ].filter((hotkey, index, hotkeys) => hotkey && hotkeys.indexOf(hotkey) === index);

  for (const hotkey of preferredHotkeys) {
    let ok = false;

    try {
      ok = globalShortcut.register(hotkey, () => {
        if (!isShortcutCaptureActive) {
          togglePopup({ anchorToCursor: true });
        }
      });
    } catch {
      ok = false;
    }

    if (ok) {
      registeredHotkey = hotkey;
      return hotkey;
    }
  }

  console.warn(`Could not register global shortcut: ${preferredHotkeys.join(', ')}`);
  return null;
}

function setShortcutCaptureActive(active: boolean): void {
  if (isShortcutCaptureActive === active) {
    return;
  }

  isShortcutCaptureActive = active;

  if (active) {
    if (registeredHotkey) {
      globalShortcut.unregister(registeredHotkey);
      registeredHotkey = null;
    }
    return;
  }

  registerGlobalShortcut({ allowFallback: true });
}

function syncLaunchAtStartup(): void {
  if (isMac && isDev) {
    return;
  }

  try {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtStartup,
      path: process.execPath,
      ...(isMac ? { openAsHidden: true } : {})
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

function syncTray(): void {
  if (!settings.showTrayIcon && !isMac) {
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
            accelerator: macDefaultHotkey,
            click: () => showPopup({ anchorToCursor: true })
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
  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:update', (_event, patch: DeepPartial<FloatAISettings>) => updateSettings(patch));
  ipcMain.handle('window:openSettings', () => openIntegratedSettings());
  ipcMain.handle('popup:toggle', () => togglePopup());
  ipcMain.handle('popup:hide', () => hidePopup());
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
  ipcMain.handle('popup:savePosition', (_event, position: PopupPosition) => savePopupPosition(position));
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
}

registerIpc();

app.on('second-instance', () => {
  showPopup();
});

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    contents.setWindowOpenHandler(() => {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          width: 800,
          height: 800
        }
      };
    });

    contents.on('did-create-window', (window, details) => {
      const isAuthPopup = 
        details.url === 'about:blank' || 
        details.url === '' ||
        details.disposition === 'new-window' || 
        !!details.url.match(/oauth|login|signin|auth|accounts\.google|appleid\.apple/i);

      if (!isAuthPopup) {
        shell.openExternal(details.url);
        window.close();
      }
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

app.whenReady().then(() => {
  app.userAgentFallback = app.userAgentFallback.replace(/Electron\/[\d.]+ /, '');
  
  if (isMac) {
    app.dock?.hide();
  }

  settings = applyPlatformSettings(deepMergeSettings(defaultSettings, store.store as DeepPartial<FloatAISettings>));
  store.set(settings);
  
  nativeTheme.themeSource = settings.darkMode ? 'dark' : 'light';

  setupApplicationMenu();
  syncLaunchAtStartup();
  syncTray();
  registerGlobalShortcut({ allowFallback: true });

  // When the app launches at startup the network may not be ready yet,
  // causing webviews to show blank pages.  Poll for connectivity and
  // trigger a reload once the network comes up.
  if (settings.launchAtStartup && !net.isOnline()) {
    waitForNetworkAndReload();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  savePopupPosition();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('activate', () => {
  showPopup();
});

app.on('window-all-closed', () => {
  // Keep the app resident so the global shortcut and tray can reopen the popup.
});
