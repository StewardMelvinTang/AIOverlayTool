import type { AddonStorageState, ScratchPadStorageState } from './addons';
import type { FloatAISettings } from './settings';

export const portableBackupFormat = 'float-ai-portable-backup';
export const portableBackupVersion = 1;
export const portableBackupExtension = 'floatai-backup.json';

export type PortableProviderIcon = {
  fileName: string;
  dataBase64: string;
};

export type PortableBackupFile = {
  format: typeof portableBackupFormat;
  formatVersion: typeof portableBackupVersion;
  appVersion: string;
  exportedAt: string;
  sourcePlatform: string;
  includedData: {
    settings: true;
    providers: true;
    providerIcons: true;
    addons: true;
    scratchPad: true;
    loginSessions: false;
  };
  data: {
    settings: FloatAISettings;
    addons: AddonStorageState;
    scratchPad: ScratchPadStorageState;
    providerIcons: Record<string, PortableProviderIcon>;
  };
};

export type PortableBackupSummary = {
  providers: number;
  customProviderIcons: number;
  installedAddons: number;
  scratchPadNotes: number;
};

export type PortableBackupResult = {
  canceled: boolean;
  filePath?: string;
  summary?: PortableBackupSummary;
  warnings?: string[];
};
