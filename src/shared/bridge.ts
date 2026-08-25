import type { DeepPartial, FloatAISettings, Provider } from './settings';
import type {
  AddonDownloadTask,
  AddonStorageState,
  ScratchPadNote,
  ScratchPadNotePatch
} from './addons';
import type { PortableBackupResult } from './backup';

export const providerWebSessionPartition = 'persist:floatai-sites';

export type PopupSize = {
  width: number;
  height: number;
};

export type PopupPosition = {
  x: number;
  y: number;
};

export type WebviewNavigationDirection = 'back' | 'forward';

export type ProviderIconPickResult = {
  icon: string;
  url: string;
};

export type ProviderAudioState = {
  webContentsId: number;
  audible: boolean;
};

export type MemoryPressureState = {
  includeSelected: boolean;
};

export type ProviderBrowserNavigationState = {
  url: string;
  title: string;
  canGoBack: boolean;
  isLoading: boolean;
};

export type ProviderBrowserDownloadStatus =
  | 'idle'
  | 'starting'
  | 'progressing'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'interrupted';

export type ProviderBrowserDownloadState = {
  status: ProviderBrowserDownloadStatus;
  filename: string;
  receivedBytes: number;
  totalBytes: number;
  percent: number | null;
  activeCount: number;
  canReveal: boolean;
};

export type ProviderBrowserState = {
  navigation: ProviderBrowserNavigationState;
  download: ProviderBrowserDownloadState;
};

export type RendererErrorReport = {
  kind: 'window-error' | 'unhandled-rejection' | 'react-error';
  message: string;
  stack?: string;
  componentStack?: string;
};

export type QuickAskSubmitPayload = {
  providerId: string;
  prompt: string;
};

export type QuickAskRequest = QuickAskSubmitPayload & {
  id: string;
  targetUrl: string;
};

export type FloatAIBridge = {
  platform: string;
  getSettings: () => Promise<FloatAISettings>;
  updateSettings: (patch: DeepPartial<FloatAISettings>) => Promise<FloatAISettings>;
  openSettings: () => Promise<void>;
  togglePopup: () => Promise<void>;
  hidePopup: () => Promise<void>;
  hideQuickAsk: () => Promise<void>;
  submitQuickAsk: (payload: QuickAskSubmitPayload) => Promise<void>;
  setShortcutCaptureActive: (active: boolean) => Promise<void>;
  switchProvider: (providerId: string) => Promise<Provider>;
  registerProviderWebContents: (providerId: string, webContentsId: number) => Promise<boolean>;
  pickProviderIcon: () => Promise<ProviderIconPickResult | null>;
  getProviderIconFromUrl: (url: string) => Promise<ProviderIconPickResult>;
  resolveProviderIcon: (icon: string) => Promise<string>;
  resizePopup: (size: PopupSize) => Promise<FloatAISettings>;
  resizePopupInteractive: (size: PopupSize) => Promise<void>;
  beginPopupMoveInteractive: () => Promise<void>;
  movePopupInteractive: () => Promise<void>;
  endPopupMoveInteractive: (savePosition: boolean) => Promise<FloatAISettings | void>;
  savePopupPosition: (position?: PopupPosition) => Promise<FloatAISettings>;
  getAddonState: () => Promise<AddonStorageState>;
  installAddon: (addonId: string) => Promise<AddonStorageState>;
  uninstallAddon: (addonId: string) => Promise<AddonStorageState>;
  getAddonDownloads: () => Promise<AddonDownloadTask[]>;
  getScratchPadNotes: () => Promise<ScratchPadNote[]>;
  createScratchPadNote: () => Promise<ScratchPadNote>;
  updateScratchPadNote: (noteId: string, patch: ScratchPadNotePatch) => Promise<ScratchPadNote>;
  deleteScratchPadNote: (noteId: string) => Promise<ScratchPadNote[]>;
  copyText: (text: string) => Promise<void>;
  getProviderBrowserState: () => Promise<ProviderBrowserState | null>;
  providerBrowserBack: () => Promise<boolean>;
  closeProviderBrowser: () => Promise<boolean>;
  copyProviderBrowserUrl: () => Promise<boolean>;
  revealProviderBrowserDownload: () => Promise<boolean>;
  exportPortableBackup: () => Promise<PortableBackupResult>;
  importPortableBackup: () => Promise<PortableBackupResult>;
  reportRendererError: (report: RendererErrorReport) => void;
  onSettingsChanged: (callback: (settings: FloatAISettings) => void) => () => void;
  onProviderChanged: (callback: (provider: Provider) => void) => () => void;
  onProviderAudioStateChanged: (callback: (state: ProviderAudioState) => void) => () => void;
  onMemoryPressure: (callback: (state: MemoryPressureState) => void) => () => void;
  onProviderBrowserStateChanged: (callback: (state: ProviderBrowserState) => void) => () => void;
  onQuickAskSubmitted: (callback: (request: QuickAskRequest) => void) => () => void;
  onQuickAskAnimate: (callback: (state: 'in' | 'out') => void) => () => void;
  onOpenSettingsRequested: (callback: () => void) => () => void;
  onWebviewNavigation: (callback: (direction: WebviewNavigationDirection) => void) => () => void;
  onAnimate: (callback: (state: 'in' | 'out') => void) => () => void;
  onReloadAllWebviews: (callback: () => void) => () => void;
};
