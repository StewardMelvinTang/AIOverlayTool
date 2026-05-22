import type { AddonManifest } from './addons';

export const officialAddons: AddonManifest[] = [
  {
    id: 'scratchpad',
    title: 'ScratchPad',
    description: 'Quick local notes that stay inside Float AI.',
    author: 'Float AI Team',
    version: '1.0.0',
    icon: 'sticky-note',
    category: 'Productivity',
    type: 'builtin',
    official: true,
    permissions: ['storage']
  },
  {
    id: 'speedtest',
    title: 'SpeedTest',
    description: 'Run a quick network speed test without opening a browser.',
    author: 'Float AI Team',
    version: '1.0.0',
    icon: 'gauge',
    category: 'Utilities',
    type: 'builtin',
    official: true,
    permissions: ['network']
  }
];

export function getAvailableAddonManifests(): AddonManifest[] {
  return officialAddons;
}

export function getAddonManifest(addonId: string): AddonManifest | undefined {
  return officialAddons.find((addon) => addon.id === addonId);
}

// TODO: Fetch registry.json from a reviewed GitHub repository.
// TODO: Compare versions and mark update availability.
// TODO: Verify SHA256 before installing external addon packages.
// TODO: Download addon packages into userData/addons after verification.
// TODO: Extract packages with a sandboxed runtime contract before enabling them.
