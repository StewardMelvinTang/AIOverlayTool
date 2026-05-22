import Store from 'electron-store';
import type { AddonDownloadTask, AddonStorageState, InstalledAddonState } from '../shared/addons';
import { getAddonManifest, getAvailableAddonManifests } from '../shared/addonsRegistry';

const addonStore = new Store<AddonStorageState>({
  name: 'float-ai-addons',
  defaults: {
    installedAddons: {}
  }
});

let addonState = normalizeAddonStorageState(addonStore.store);

export function getAddonState(): AddonStorageState {
  return addonState;
}

export function installAddon(addonId: string): AddonStorageState {
  const manifest = getAddonManifest(addonId);

  if (!manifest || manifest.type !== 'builtin') {
    throw new Error('Only bundled official add-ons can be installed in this version of Float AI.');
  }

  const now = new Date().toISOString();
  const existingAddon = addonState.installedAddons[addonId];

  return saveAddonState({
    installedAddons: {
      ...addonState.installedAddons,
      [addonId]: {
        addonId,
        installedVersion: manifest.version,
        enabled: true,
        installedAt: existingAddon?.installedAt ?? now,
        updatedAt: now
      }
    }
  });
}

export function uninstallAddon(addonId: string): AddonStorageState {
  if (!addonState.installedAddons[addonId]) {
    return addonState;
  }

  const installedAddons = { ...addonState.installedAddons };
  delete installedAddons[addonId];
  return saveAddonState({ installedAddons });
}

export function getAddonDownloads(): AddonDownloadTask[] {
  return [];
}

function saveAddonState(nextState: AddonStorageState): AddonStorageState {
  addonState = normalizeAddonStorageState(nextState);
  addonStore.set(addonState);
  return addonState;
}

function normalizeAddonStorageState(value: unknown): AddonStorageState {
  const input = value && typeof value === 'object' ? (value as Partial<AddonStorageState>) : {};
  const installedAddonsInput =
    input.installedAddons && typeof input.installedAddons === 'object' ? input.installedAddons : {};
  const availableAddonIds = new Set(getAvailableAddonManifests().map((addon) => addon.id));
  const installedAddons: Record<string, InstalledAddonState> = {};

  for (const [addonId, addonValue] of Object.entries(installedAddonsInput)) {
    if (!availableAddonIds.has(addonId) || !addonValue || typeof addonValue !== 'object') {
      continue;
    }

    const installedAddon = addonValue as Partial<InstalledAddonState>;

    if (
      installedAddon.addonId !== addonId ||
      typeof installedAddon.installedVersion !== 'string' ||
      typeof installedAddon.installedAt !== 'string' ||
      typeof installedAddon.updatedAt !== 'string'
    ) {
      continue;
    }

    installedAddons[addonId] = {
      addonId,
      installedVersion: installedAddon.installedVersion,
      enabled: typeof installedAddon.enabled === 'boolean' ? installedAddon.enabled : true,
      installedAt: installedAddon.installedAt,
      updatedAt: installedAddon.updatedAt
    };
  }

  return {
    installedAddons
  };
}
