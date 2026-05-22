export type AddonPermission =
  | 'storage'
  | 'network'
  | 'clipboard'
  | 'providerWebRequest'
  | 'notifications';

export type AddonManifest = {
  id: string;
  title: string;
  description: string;
  author: string;
  version: string;
  minAppVersion?: string;
  icon?: string;
  category?: string;
  permissions: AddonPermission[];
  type: 'builtin' | 'panel';
  entry?: string;
  official?: boolean;
};

export type InstalledAddonState = {
  addonId: string;
  installedVersion: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
};

export type AddonStorageState = {
  installedAddons: Record<string, InstalledAddonState>;
};

export type AddonDownloadTask = {
  id: string;
  addonId: string;
  addonTitle: string;
  status: 'queued' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  speedBytesPerSecond?: number;
  error?: string;
};

export type ScratchPadNote = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type ScratchPadNotePatch = Partial<Pick<ScratchPadNote, 'title' | 'content'>>;

export type ScratchPadStorageState = {
  notes: ScratchPadNote[];
};
