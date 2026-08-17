import {
  app,
  BrowserWindow,
  clipboard,
  shell,
  WebContentsView,
  type DownloadItem,
  type Session,
  type WebContents
} from 'electron';
import path from 'node:path';
import type {
  ProviderBrowserDownloadState,
  ProviderBrowserState
} from '../shared/bridge';
import { classifyExternalNavigationUrl } from './externalNavigation';

type ProviderBrowserManagerOptions = {
  appName: string;
  sessionPartition: string;
  toolbarHeight: number;
  getParentWindow: () => BrowserWindow | null;
  getPreloadPath: () => string;
  getIconPath: () => string;
  loadToolbarRenderer: (window: BrowserWindow) => void;
  shouldCaptureContent: () => boolean;
  shouldStayAlwaysOnTop: () => boolean;
  attachContentDiagnostics: (contents: WebContents) => void;
  openExternalUrl: (url: string, source: string) => void;
  logInfo: (event: string, details?: unknown) => void;
  logWarn: (event: string, details?: unknown) => void;
  logError: (event: string, error: unknown, details?: Record<string, unknown>) => void;
  isMac: boolean;
};

type ActiveDownload = {
  item: DownloadItem;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
};

type ProviderBrowserRecord = {
  window: BrowserWindow;
  contentView: WebContentsView;
  state: ProviderBrowserState;
  activeDownloads: Map<DownloadItem, ActiveDownload>;
  lastCompletedPath: string;
  disposed: boolean;
};

const idleDownloadState: ProviderBrowserDownloadState = {
  status: 'idle',
  filename: '',
  receivedBytes: 0,
  totalBytes: 0,
  percent: null,
  activeCount: 0,
  canReveal: false
};

export class ProviderBrowserManager {
  private readonly recordsByWindowId = new Map<number, ProviderBrowserRecord>();
  private readonly recordsByContentId = new Map<number, ProviderBrowserRecord>();
  private readonly configuredDownloadSessions = new WeakSet<Session>();

  constructor(private readonly options: ProviderBrowserManagerOptions) {}

  hasOpenWindows(): boolean {
    return this.recordsByWindowId.size > 0;
  }

  getOpenWindowCount(): number {
    return this.recordsByWindowId.size;
  }

  ownsToolbarContents(contents: WebContents): boolean {
    return Boolean(this.getRecordForToolbar(contents));
  }

  open(url: string, source: string): boolean {
    const target = classifyExternalNavigationUrl(url);

    if (target.kind !== 'web') {
      this.options.openExternalUrl(url, source);
      return false;
    }

    const parent = this.options.getParentWindow();
    const usableParent = parent && !parent.isDestroyed() ? parent : undefined;
    const browserWindow = new BrowserWindow({
      title: `${this.options.appName} Browser`,
      icon: this.options.getIconPath(),
      width: 980,
      height: 760,
      minWidth: 560,
      minHeight: 420,
      parent: usableParent,
      show: false,
      frame: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      fullscreenable: true,
      autoHideMenuBar: true,
      backgroundColor: '#101214',
      alwaysOnTop: this.options.shouldStayAlwaysOnTop(),
      webPreferences: {
        preload: this.options.getPreloadPath(),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: false
      }
    });

    const contentView = new WebContentsView({
      webPreferences: {
        partition: this.options.sessionPartition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        disableDialogs: false,
        safeDialogs: true
      }
    });

    const record: ProviderBrowserRecord = {
      window: browserWindow,
      contentView,
      state: {
        navigation: {
          url,
          title: 'Loading…',
          canGoBack: false,
          isLoading: true
        },
        download: { ...idleDownloadState }
      },
      activeDownloads: new Map(),
      lastCompletedPath: '',
      disposed: false
    };

    this.recordsByWindowId.set(browserWindow.id, record);
    this.recordsByContentId.set(contentView.webContents.id, record);
    browserWindow.contentView.addChildView(contentView);
    browserWindow.setContentProtection(this.options.shouldCaptureContent());
    browserWindow.setMenuBarVisibility(false);
    this.resizeContentView(record);
    this.configureToolbar(record);
    this.configureContent(record);
    this.configureDownloadSession(contentView.webContents.session);

    browserWindow.on('resize', () => this.resizeContentView(record));
    browserWindow.on('maximize', () => this.resizeContentView(record));
    browserWindow.on('unmaximize', () => this.resizeContentView(record));
    browserWindow.on('app-command', (_event, command) => {
      if (command === 'browser-backward') {
        this.goBackForRecord(record);
      }
    });
    browserWindow.on('close', () => this.disposeRecord(record, 'window-close'));
    browserWindow.on('closed', () => this.disposeRecord(record, 'window-closed'));

    if (this.options.isMac) {
      browserWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    browserWindow.once('ready-to-show', () => {
      if (!record.disposed && !browserWindow.isDestroyed()) {
        browserWindow.show();
        browserWindow.focus();
      }
    });

    this.options.loadToolbarRenderer(browserWindow);
    void contentView.webContents.loadURL(url).catch((error) => {
      if (record.disposed) {
        return;
      }

      record.state.navigation.isLoading = false;
      this.sendState(record);
      this.options.logError('provider-browser-load-rejected', error, {
        webContentsId: contentView.webContents.id
      });
    });

    this.options.logInfo('provider-browser-opened', {
      windowId: browserWindow.id,
      webContentsId: contentView.webContents.id,
      source
    });
    return true;
  }

  closeAll(reason: string): void {
    for (const record of [...this.recordsByWindowId.values()]) {
      this.closeRecord(record, reason);
    }
  }

  getStateForToolbar(contents: WebContents): ProviderBrowserState | null {
    const record = this.getRecordForToolbar(contents);
    return record ? this.cloneState(record.state) : null;
  }

  goBack(contents: WebContents): boolean {
    const record = this.getRecordForToolbar(contents);
    return record ? this.goBackForRecord(record) : false;
  }

  close(contents: WebContents): boolean {
    const record = this.getRecordForToolbar(contents);
    if (!record) {
      return false;
    }

    this.closeRecord(record, 'toolbar-close');
    return true;
  }

  copyCurrentUrl(contents: WebContents): boolean {
    const record = this.getRecordForToolbar(contents);
    if (!record || !record.state.navigation.url) {
      return false;
    }

    clipboard.writeText(record.state.navigation.url);
    return true;
  }

  revealDownload(contents: WebContents): boolean {
    const record = this.getRecordForToolbar(contents);
    if (!record?.lastCompletedPath) {
      return false;
    }

    shell.showItemInFolder(record.lastCompletedPath);
    return true;
  }

  private configureToolbar(record: ProviderBrowserRecord): void {
    const toolbarContents = record.window.webContents;

    toolbarContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    toolbarContents.on('did-finish-load', () => this.sendState(record));
    toolbarContents.on('render-process-gone', (_event, details) => {
      if (record.disposed || details.reason === 'clean-exit') {
        return;
      }

      this.options.logWarn('provider-browser-toolbar-render-process-gone', {
        windowId: record.window.id,
        reason: details.reason,
        exitCode: details.exitCode
      });
      this.closeRecord(record, `toolbar-render-process-gone:${details.reason}`);
    });
  }

  private configureContent(record: ProviderBrowserRecord): void {
    const contents = record.contentView.webContents;
    this.options.attachContentDiagnostics(contents);

    contents.setWindowOpenHandler(({ url }) => {
      setImmediate(() => this.open(url, 'provider-browser-window-open'));
      return { action: 'deny' };
    });

    contents.on('will-frame-navigate', (event) => {
      this.routeExternalNavigation(event, event.url, 'provider-browser-frame-navigation');
    });
    contents.on('will-redirect', (event, url) => {
      this.routeExternalNavigation(event, url, 'provider-browser-redirect');
    });
    contents.on('did-start-loading', () => {
      record.state.navigation.isLoading = true;
      this.updateNavigationState(record);
    });
    contents.on('did-stop-loading', () => {
      record.state.navigation.isLoading = false;
      this.updateNavigationState(record);
    });
    contents.on('did-navigate', (_event, url) => {
      record.state.navigation.url = url;
      this.updateNavigationState(record);
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) {
        record.state.navigation.url = url;
        this.updateNavigationState(record);
      }
    });
    contents.on('page-title-updated', (_event, title) => {
      record.state.navigation.title = title;
      if (!record.window.isDestroyed()) {
        record.window.setTitle(title ? `${title} — ${this.options.appName}` : `${this.options.appName} Browser`);
      }
      this.sendState(record);
    });
    contents.on('render-process-gone', (_event, details) => {
      if (record.disposed || details.reason === 'clean-exit') {
        return;
      }

      this.options.logWarn('provider-browser-content-render-process-gone', {
        windowId: record.window.id,
        webContentsId: contents.id,
        reason: details.reason,
        exitCode: details.exitCode
      });
      this.closeRecord(record, `content-render-process-gone:${details.reason}`);
    });
    contents.once('destroyed', () => {
      if (!record.disposed) {
        this.closeRecord(record, 'content-destroyed');
      }
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
      if (!isMainFrame || errorCode === -3 || record.disposed) {
        return;
      }

      record.state.navigation.isLoading = false;
      this.updateNavigationState(record);
      this.options.logWarn('provider-browser-load-failed', {
        webContentsId: contents.id,
        errorCode,
        errorDescription
      });
    });
  }

  private routeExternalNavigation(event: Electron.Event, url: string, source: string): void {
    if (url === 'about:blank' || classifyExternalNavigationUrl(url).kind === 'web') {
      return;
    }

    event.preventDefault();
    this.options.openExternalUrl(url, source);
  }

  private configureDownloadSession(downloadSession: Session): void {
    if (this.configuredDownloadSessions.has(downloadSession)) {
      return;
    }

    this.configuredDownloadSessions.add(downloadSession);
    downloadSession.on('will-download', (_event, item, webContents) => {
      const record = this.recordsByContentId.get(webContents.id);
      if (!record || record.disposed) {
        return;
      }

      this.trackDownload(record, item);
    });
  }

  private trackDownload(record: ProviderBrowserRecord, item: DownloadItem): void {
    const filename = path.basename(item.getFilename()) || 'download';
    const activeDownload: ActiveDownload = {
      item,
      filename,
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes()
    };

    try {
      item.setSaveDialogOptions({
        title: 'Save download',
        buttonLabel: 'Save',
        defaultPath: path.join(app.getPath('downloads'), filename)
      });
    } catch (error) {
      this.options.logError('provider-browser-save-dialog-options-failed', error, {
        webContentsId: record.contentView.webContents.id
      });
    }

    record.activeDownloads.set(item, activeDownload);
    this.updateActiveDownloadState(record, 'starting');
    this.options.logInfo('provider-browser-download-started', {
      windowId: record.window.id,
      activeCount: record.activeDownloads.size,
      hasUserGesture: item.hasUserGesture()
    });

    item.on('updated', (_event, state) => {
      if (record.disposed || !record.activeDownloads.has(item)) {
        return;
      }

      activeDownload.receivedBytes = item.getReceivedBytes();
      activeDownload.totalBytes = item.getTotalBytes();
      this.updateActiveDownloadState(record, item.isPaused() ? 'paused' : state);
    });

    item.once('done', (_event, state) => {
      record.activeDownloads.delete(item);
      if (record.disposed) {
        return;
      }

      if (state === 'completed') {
        record.lastCompletedPath = item.getSavePath();
      }

      const receivedBytes = item.getReceivedBytes();
      const totalBytes = item.getTotalBytes();

      if (record.activeDownloads.size > 0) {
        this.updateActiveDownloadState(record, 'progressing');
      } else {
        record.state.download = {
          status: state,
          filename,
          receivedBytes,
          totalBytes,
          percent: state === 'completed'
            ? 100
            : totalBytes > 0
              ? Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100))
              : null,
          activeCount: 0,
          canReveal: state === 'completed' && Boolean(record.lastCompletedPath)
        };
        if (!record.window.isDestroyed()) {
          record.window.setProgressBar(-1);
        }
        this.sendState(record);
      }

      this.options.logInfo('provider-browser-download-finished', {
        windowId: record.window.id,
        state,
        receivedBytes,
        totalBytes
      });
    });
  }

  private updateActiveDownloadState(
    record: ProviderBrowserRecord,
    status: 'starting' | 'progressing' | 'paused' | 'interrupted'
  ): void {
    const downloads = [...record.activeDownloads.values()];
    const receivedBytes = downloads.reduce((sum, download) => sum + download.receivedBytes, 0);
    const hasKnownTotals = downloads.length > 0 && downloads.every((download) => download.totalBytes > 0);
    const totalBytes = hasKnownTotals
      ? downloads.reduce((sum, download) => sum + download.totalBytes, 0)
      : 0;
    const percent = totalBytes > 0 ? Math.max(0, Math.min(100, (receivedBytes / totalBytes) * 100)) : null;

    record.state.download = {
      status,
      filename: downloads.length === 1 ? downloads[0].filename : `${downloads.length} files`,
      receivedBytes,
      totalBytes,
      percent,
      activeCount: downloads.length,
      canReveal: false
    };

    if (!record.window.isDestroyed()) {
      record.window.setProgressBar(percent === null ? 2 : percent / 100);
    }
    this.sendState(record);
  }

  private updateNavigationState(record: ProviderBrowserRecord): void {
    if (record.disposed || record.contentView.webContents.isDestroyed()) {
      return;
    }

    const contents = record.contentView.webContents;
    record.state.navigation.url = contents.getURL() || record.state.navigation.url;
    record.state.navigation.title = contents.getTitle() || record.state.navigation.title;
    record.state.navigation.canGoBack = contents.navigationHistory.canGoBack();
    this.sendState(record);
  }

  private goBackForRecord(record: ProviderBrowserRecord): boolean {
    if (record.disposed || record.contentView.webContents.isDestroyed()) {
      return false;
    }

    const history = record.contentView.webContents.navigationHistory;
    if (!history.canGoBack()) {
      return false;
    }

    history.goBack();
    return true;
  }

  private resizeContentView(record: ProviderBrowserRecord): void {
    if (record.disposed || record.window.isDestroyed()) {
      return;
    }

    const [width, height] = record.window.getContentSize();
    record.contentView.setBounds({
      x: 0,
      y: this.options.toolbarHeight,
      width: Math.max(1, width),
      height: Math.max(1, height - this.options.toolbarHeight)
    });
  }

  private closeRecord(record: ProviderBrowserRecord, reason: string): void {
    this.disposeRecord(record, reason);
    if (!record.window.isDestroyed()) {
      record.window.destroy();
    }
  }

  private disposeRecord(record: ProviderBrowserRecord, reason: string): void {
    if (record.disposed) {
      return;
    }

    record.disposed = true;
    this.recordsByWindowId.delete(record.window.id);
    this.recordsByContentId.delete(record.contentView.webContents.id);

    for (const download of record.activeDownloads.values()) {
      try {
        download.item.cancel();
      } catch {
        // The item may already have reached a terminal state.
      }
    }
    record.activeDownloads.clear();

    try {
      if (!record.window.isDestroyed()) {
        record.window.contentView.removeChildView(record.contentView);
      }
    } catch {
      // The native window may already be tearing down its view hierarchy.
    }

    if (!record.contentView.webContents.isDestroyed()) {
      record.contentView.webContents.close({ waitForBeforeUnload: false });
    }

    this.options.logInfo('provider-browser-closed', {
      windowId: record.window.id,
      reason
    });
  }

  private getRecordForToolbar(contents: WebContents): ProviderBrowserRecord | null {
    const browserWindow = BrowserWindow.fromWebContents(contents);
    if (!browserWindow) {
      return null;
    }

    const record = this.recordsByWindowId.get(browserWindow.id);
    return record && record.window.webContents === contents && !record.disposed ? record : null;
  }

  private sendState(record: ProviderBrowserRecord): void {
    if (record.disposed || record.window.isDestroyed() || record.window.webContents.isDestroyed()) {
      return;
    }

    try {
      record.window.webContents.send('providerBrowser:stateChanged', this.cloneState(record.state));
    } catch (error) {
      this.options.logError('provider-browser-state-send-failed', error, { windowId: record.window.id });
    }
  }

  private cloneState(state: ProviderBrowserState): ProviderBrowserState {
    return {
      navigation: { ...state.navigation },
      download: { ...state.download }
    };
  }
}
