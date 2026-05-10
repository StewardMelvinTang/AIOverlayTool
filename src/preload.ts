import { contextBridge, ipcRenderer } from 'electron';
import type {
  FloatAIBridge,
  PopupPosition,
  PopupSize,
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
  switchProvider: (providerId: string) => ipcRenderer.invoke('provider:switch', providerId) as Promise<Provider>,
  pickProviderIcon: () => ipcRenderer.invoke('provider:pickIcon'),
  resolveProviderIcon: (icon: string) => ipcRenderer.invoke('provider:resolveIcon', icon) as Promise<string>,
  resizePopup: (size: PopupSize) => ipcRenderer.invoke('popup:resize', size) as Promise<FloatAISettings>,
  resizePopupInteractive: (size: PopupSize) => ipcRenderer.invoke('popup:resizeInteractive', size) as Promise<void>,
  savePopupPosition: (position: PopupPosition) =>
    ipcRenderer.invoke('popup:savePosition', position) as Promise<FloatAISettings>,
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
