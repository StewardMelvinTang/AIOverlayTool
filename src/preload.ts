import { contextBridge, ipcRenderer } from 'electron';
import type {
  FloatAIBridge,
  MemoryPressureState,
  PopupPosition,
  ProviderAudioState,
  ProviderIconPickResult,
  PopupSize,
  QuickAskRequest,
  QuickAskSubmitPayload,
  RendererErrorReport,
  WebviewNavigationDirection
} from './shared/bridge';
import type { DeepPartial, FloatAISettings, Provider } from './shared/settings';

const bridge: FloatAIBridge = {
  platform: process.platform,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<FloatAISettings>,
  updateSettings: (patch: DeepPartial<FloatAISettings>) =>
    ipcRenderer.invoke('settings:update', patch) as Promise<FloatAISettings>,
  openSettings: () => ipcRenderer.invoke('window:openSettings') as Promise<void>,
  togglePopup: () => ipcRenderer.invoke('popup:toggle') as Promise<void>,
  hidePopup: () => ipcRenderer.invoke('popup:hide') as Promise<void>,
  hideQuickAsk: () => ipcRenderer.invoke('quickAsk:hide') as Promise<void>,
  submitQuickAsk: (payload: QuickAskSubmitPayload) => ipcRenderer.invoke('quickAsk:submit', payload) as Promise<void>,
  setShortcutCaptureActive: (active: boolean) => ipcRenderer.invoke('shortcut:captureActive', active) as Promise<void>,
  switchProvider: (providerId: string) => ipcRenderer.invoke('provider:switch', providerId) as Promise<Provider>,
  pickProviderIcon: () => ipcRenderer.invoke('provider:pickIcon'),
  getProviderIconFromUrl: (url: string) =>
    ipcRenderer.invoke('provider:getIconFromUrl', url) as Promise<ProviderIconPickResult>,
  resolveProviderIcon: (icon: string) => ipcRenderer.invoke('provider:resolveIcon', icon) as Promise<string>,
  resizePopup: (size: PopupSize) => ipcRenderer.invoke('popup:resize', size) as Promise<FloatAISettings>,
  resizePopupInteractive: (size: PopupSize) => ipcRenderer.invoke('popup:resizeInteractive', size) as Promise<void>,
  beginPopupMoveInteractive: () => ipcRenderer.invoke('popup:beginMoveInteractive') as Promise<void>,
  movePopupInteractive: () => ipcRenderer.invoke('popup:moveInteractive') as Promise<void>,
  endPopupMoveInteractive: (savePosition: boolean) =>
    ipcRenderer.invoke('popup:endMoveInteractive', savePosition) as Promise<FloatAISettings | void>,
  savePopupPosition: (position?: PopupPosition) =>
    ipcRenderer.invoke('popup:savePosition', position) as Promise<FloatAISettings>,
  getAddonState: () => ipcRenderer.invoke('addons:getState'),
  installAddon: (addonId: string) => ipcRenderer.invoke('addons:install', addonId),
  uninstallAddon: (addonId: string) => ipcRenderer.invoke('addons:uninstall', addonId),
  getAddonDownloads: () => ipcRenderer.invoke('addons:getDownloads'),
  getScratchPadNotes: () => ipcRenderer.invoke('scratchpad:getNotes'),
  createScratchPadNote: () => ipcRenderer.invoke('scratchpad:createNote'),
  updateScratchPadNote: (noteId, patch) => ipcRenderer.invoke('scratchpad:updateNote', noteId, patch),
  deleteScratchPadNote: (noteId) => ipcRenderer.invoke('scratchpad:deleteNote', noteId),
  copyText: (text) => ipcRenderer.invoke('clipboard:writeText', text) as Promise<void>,
  exportPortableBackup: () => ipcRenderer.invoke('backup:export'),
  importPortableBackup: () => ipcRenderer.invoke('backup:import'),
  reportRendererError: (report: RendererErrorReport) => ipcRenderer.send('diagnostics:rendererError', report),
  onSettingsChanged: (callback: (settings: FloatAISettings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, nextSettings: FloatAISettings) => callback(nextSettings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  },
  onProviderChanged: (callback: (provider: Provider) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, provider: Provider) => callback(provider);
    ipcRenderer.on('provider:changed', listener);
    return () => ipcRenderer.removeListener('provider:changed', listener);
  },
  onProviderAudioStateChanged: (callback: (state: ProviderAudioState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ProviderAudioState) => callback(state);
    ipcRenderer.on('provider:audioStateChanged', listener);
    return () => ipcRenderer.removeListener('provider:audioStateChanged', listener);
  },
  onMemoryPressure: (callback: (state: MemoryPressureState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: MemoryPressureState) => callback(state);
    ipcRenderer.on('memory:pressure', listener);
    return () => ipcRenderer.removeListener('memory:pressure', listener);
  },
  onQuickAskSubmitted: (callback: (request: QuickAskRequest) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, request: QuickAskRequest) => callback(request);
    ipcRenderer.on('quickAsk:submitted', listener);
    return () => ipcRenderer.removeListener('quickAsk:submitted', listener);
  },
  onQuickAskAnimate: (callback: (state: 'in' | 'out') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: 'in' | 'out') => callback(state);
    ipcRenderer.on('quickAsk:animate', listener);
    return () => ipcRenderer.removeListener('quickAsk:animate', listener);
  },
  onOpenSettingsRequested: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('popup:openSettings', listener);
    return () => ipcRenderer.removeListener('popup:openSettings', listener);
  },
  onWebviewNavigation: (callback: (direction: WebviewNavigationDirection) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, direction: WebviewNavigationDirection) => callback(direction);
    ipcRenderer.on('webview:navigate', listener);
    return () => ipcRenderer.removeListener('webview:navigate', listener);
  },
  onAnimate: (callback: (state: 'in' | 'out') => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: 'in' | 'out') => callback(state);
    ipcRenderer.on('popup:animate', listener);
    return () => ipcRenderer.removeListener('popup:animate', listener);
  },
  onReloadAllWebviews: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('webview:reloadAll', listener);
    return () => ipcRenderer.removeListener('webview:reloadAll', listener);
  }
};

contextBridge.exposeInMainWorld('floatAI', bridge);
