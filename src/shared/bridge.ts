import type { DeepPartial, FloatAISettings, Provider } from './settings';
import type {
  AddonDownloadTask,
  AddonStorageState,
  ScratchPadNote,
  ScratchPadNotePatch
} from './addons';

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

export type FloatAIBridge = {
  platform: string;
  getSettings: () => Promise<FloatAISettings>;
  updateSettings: (patch: DeepPartial<FloatAISettings>) => Promise<FloatAISettings>;
  openSettings: () => Promise<void>;
  togglePopup: () => Promise<void>;
  hidePopup: () => Promise<void>;
  setShortcutCaptureActive: (active: boolean) => Promise<void>;
  switchProvider: (providerId: string) => Promise<Provider>;
  pickProviderIcon: () => Promise<ProviderIconPickResult | null>;
  getProviderIconFromUrl: (url: string) => Promise<ProviderIconPickResult>;
  resolveProviderIcon: (icon: string) => Promise<string>;
  resizePopup: (size: PopupSize) => Promise<FloatAISettings>;
  resizePopupInteractive: (size: PopupSize) => Promise<void>;
  savePopupPosition: (position: PopupPosition) => Promise<FloatAISettings>;
  getAddonState: () => Promise<AddonStorageState>;
  installAddon: (addonId: string) => Promise<AddonStorageState>;
  uninstallAddon: (addonId: string) => Promise<AddonStorageState>;
  getAddonDownloads: () => Promise<AddonDownloadTask[]>;
  getScratchPadNotes: () => Promise<ScratchPadNote[]>;
  createScratchPadNote: () => Promise<ScratchPadNote>;
  updateScratchPadNote: (noteId: string, patch: ScratchPadNotePatch) => Promise<ScratchPadNote>;
  deleteScratchPadNote: (noteId: string) => Promise<ScratchPadNote[]>;
  copyText: (text: string) => Promise<void>;
  onSettingsChanged: (callback: (settings: FloatAISettings) => void) => () => void;
  onProviderChanged: (callback: (provider: Provider) => void) => () => void;
  onOpenSettingsRequested: (callback: () => void) => () => void;
  onWebviewNavigation: (callback: (direction: WebviewNavigationDirection) => void) => () => void;
  onAnimate: (callback: (state: 'in' | 'out') => void) => () => void;
  onReloadAllWebviews: (callback: () => void) => () => void;
};
