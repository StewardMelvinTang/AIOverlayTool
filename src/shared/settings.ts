export type Provider = {
  id: string;
  name: string;
  url: string;
  icon: string;
  alwaysActive: boolean;
  lastVisitedAt?: string;
};

type ProviderCandidate = Omit<Provider, 'alwaysActive'> & {
  alwaysActive?: unknown;
};

export type PopupSettings = {
  width: number;
  height: number;
  x?: number;
  y?: number;
  opacity: number;
  blur: boolean;
  alwaysOnTop: boolean;
  rememberPosition: boolean;
  hideOnBlur: boolean;
  resizableInPopup: boolean;
  showRefreshButton: boolean;
  showProviderTooltip: boolean;
  showProviderTooltipLastVisited: boolean;
};

export type ClipboardSettings = {
  copySelectedTextBeforeOpen: boolean;
  autoPaste: boolean;
};

export type QuickAskSettings = {
  hotkey: string;
  providerId: string;
};

export type PrivacySettings = {
  captureProtection: boolean;
};

export type PerformanceSettings = {
  hardwareAcceleration: boolean;
  memorySaver: boolean;
  memorySaverUnloadMinutes: number;
};

export type FloatAISettings = {
  defaultProviderId: string;
  globalHotkey: string;
  launchAtStartup: boolean;
  showTrayIcon: boolean;
  popup: PopupSettings;
  providers: Provider[];
  quickAsk: QuickAskSettings;
  clipboard: ClipboardSettings;
  privacy: PrivacySettings;
  performance: PerformanceSettings;
  enableZoomShortcuts: boolean;
  enableProviderShortcuts: boolean;
  darkMode: boolean;
  compactProviderBar: boolean;
};

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export const builtInProviders: Provider[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com',
    icon: 'chatgpt',
    alwaysActive: false
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai',
    icon: 'claude',
    alwaysActive: false
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com',
    icon: 'gemini',
    alwaysActive: false
  }
];

export const builtInProviderIds = builtInProviders.map((provider) => provider.id);
export const quickAskProviderIds = ['chatgpt', 'claude', 'gemini'];

const legacyDefaultProviderIds = new Set(['perplexity', 'copilot']);
const legacyDefaultProviderUrls = new Map([
  ['perplexity', 'https://www.perplexity.ai'],
  ['copilot', 'https://copilot.microsoft.com']
]);

export const defaultSettings: FloatAISettings = {
  defaultProviderId: 'chatgpt',
  globalHotkey: 'F20',
  launchAtStartup: false,
  showTrayIcon: true,
  popup: {
    width: 900,
    height: 700,
    x: 1000,
    y: 160,
    opacity: 1,
    blur: false,
    alwaysOnTop: true,
    rememberPosition: true,
    hideOnBlur: false,
    resizableInPopup: false,
    showRefreshButton: false,
    showProviderTooltip: true,
    showProviderTooltipLastVisited: true
  },
  providers: builtInProviders,
  quickAsk: {
    hotkey: 'Alt+Shift+K',
    providerId: 'chatgpt'
  },
  clipboard: {
    copySelectedTextBeforeOpen: false,
    autoPaste: false
  },
  privacy: {
    captureProtection: false
  },
  performance: {
    hardwareAcceleration: true,
    memorySaver: true,
    memorySaverUnloadMinutes: 2
  },
  enableZoomShortcuts: false,
  enableProviderShortcuts: false,
  darkMode: true,
  compactProviderBar: false
};

export function isBuiltInProvider(providerId: string): boolean {
  return builtInProviderIds.includes(providerId);
}

export function isQuickAskProvider(providerId: string): boolean {
  return quickAskProviderIds.includes(providerId);
}

export function createProviderId(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || `provider-${Date.now()}`;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProvider(value: unknown): value is ProviderCandidate {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const provider = value as Provider;
  return (
    typeof provider.id === 'string' &&
    typeof provider.name === 'string' &&
    typeof provider.url === 'string' &&
    typeof provider.icon === 'string' &&
    (provider.lastVisitedAt === undefined || typeof provider.lastVisitedAt === 'string') &&
    isHttpUrl(provider.url)
  );
}

export function normalizeProviders(providers: unknown): Provider[] {
  const userProviders = Array.isArray(providers)
    ? providers.filter(isProvider).map((provider) => ({
        ...provider,
        alwaysActive: provider.alwaysActive === true
      }))
    : [];
  const migratedProviders = userProviders.filter((provider) => !isLegacyDefaultProvider(provider));
  return migratedProviders.length > 0 ? migratedProviders : builtInProviders;
}

export function normalizeSettings(value: unknown): FloatAISettings {
  const input = value && typeof value === 'object' ? (value as Partial<FloatAISettings>) : {};
  const providers = normalizeProviders(input.providers);
  const defaultProviderExists = providers.some((provider) => provider.id === input.defaultProviderId);
  const fallbackProviderId = providers[0]?.id ?? defaultSettings.defaultProviderId;
  const quickAskProviderId =
    providers.find((provider) => provider.id === input.quickAsk?.providerId && isQuickAskProvider(provider.id))?.id ??
    providers.find((provider) => isQuickAskProvider(provider.id))?.id ??
    fallbackProviderId;

  return {
    defaultProviderId: defaultProviderExists ? input.defaultProviderId! : fallbackProviderId,
    globalHotkey: normalizeHotkey(input.globalHotkey, defaultSettings.globalHotkey),
    launchAtStartup:
      typeof input.launchAtStartup === 'boolean' ? input.launchAtStartup : defaultSettings.launchAtStartup,
    showTrayIcon: typeof input.showTrayIcon === 'boolean' ? input.showTrayIcon : defaultSettings.showTrayIcon,
    popup: {
      ...defaultSettings.popup,
      ...(input.popup ?? {}),
      width: clampNumber(input.popup?.width, 420, 1800, defaultSettings.popup.width),
      height: clampNumber(input.popup?.height, 360, 1400, defaultSettings.popup.height),
      opacity: clampOpacity(input.popup?.opacity, defaultSettings.popup.opacity),
      blur: false,
      alwaysOnTop:
        typeof input.popup?.alwaysOnTop === 'boolean'
          ? input.popup.alwaysOnTop
          : defaultSettings.popup.alwaysOnTop,
      rememberPosition:
        typeof input.popup?.rememberPosition === 'boolean'
          ? input.popup.rememberPosition
          : defaultSettings.popup.rememberPosition,
      hideOnBlur:
        typeof input.popup?.hideOnBlur === 'boolean' ? input.popup.hideOnBlur : defaultSettings.popup.hideOnBlur,
      resizableInPopup: false,
      showRefreshButton:
        typeof input.popup?.showRefreshButton === 'boolean'
          ? input.popup.showRefreshButton
          : defaultSettings.popup.showRefreshButton,
      showProviderTooltip:
        typeof input.popup?.showProviderTooltip === 'boolean'
          ? input.popup.showProviderTooltip
          : defaultSettings.popup.showProviderTooltip,
      showProviderTooltipLastVisited:
        typeof input.popup?.showProviderTooltipLastVisited === 'boolean'
          ? input.popup.showProviderTooltipLastVisited
          : defaultSettings.popup.showProviderTooltipLastVisited
    },
    providers,
    quickAsk: {
      ...defaultSettings.quickAsk,
      ...(input.quickAsk ?? {}),
      hotkey: normalizeHotkey(input.quickAsk?.hotkey, defaultSettings.quickAsk.hotkey),
      providerId: quickAskProviderId
    },
    clipboard: {
      ...defaultSettings.clipboard,
      ...(input.clipboard ?? {}),
      copySelectedTextBeforeOpen:
        typeof input.clipboard?.copySelectedTextBeforeOpen === 'boolean'
          ? input.clipboard.copySelectedTextBeforeOpen
          : defaultSettings.clipboard.copySelectedTextBeforeOpen,
      autoPaste:
        typeof input.clipboard?.autoPaste === 'boolean'
          ? input.clipboard.autoPaste
          : defaultSettings.clipboard.autoPaste
    },
    privacy: {
      ...defaultSettings.privacy,
      ...(input.privacy ?? {}),
      captureProtection:
        typeof input.privacy?.captureProtection === 'boolean'
          ? input.privacy.captureProtection
          : defaultSettings.privacy.captureProtection
    },
    performance: {
      ...defaultSettings.performance,
      ...(input.performance ?? {}),
      hardwareAcceleration:
        typeof input.performance?.hardwareAcceleration === 'boolean'
          ? input.performance.hardwareAcceleration
          : defaultSettings.performance.hardwareAcceleration,
      memorySaver:
        typeof input.performance?.memorySaver === 'boolean'
          ? input.performance.memorySaver
          : defaultSettings.performance.memorySaver,
      memorySaverUnloadMinutes: clampNumber(
        input.performance?.memorySaverUnloadMinutes,
        1,
        60,
        defaultSettings.performance.memorySaverUnloadMinutes
      )
    },
    enableZoomShortcuts:
      typeof input.enableZoomShortcuts === 'boolean'
        ? input.enableZoomShortcuts
        : defaultSettings.enableZoomShortcuts,
    enableProviderShortcuts:
      typeof input.enableProviderShortcuts === 'boolean'
        ? input.enableProviderShortcuts
        : defaultSettings.enableProviderShortcuts,
    darkMode:
      typeof input.darkMode === 'boolean'
        ? input.darkMode
        : defaultSettings.darkMode,
    compactProviderBar:
      typeof input.compactProviderBar === 'boolean'
        ? input.compactProviderBar
        : defaultSettings.compactProviderBar
  };
}

export function deepMergeSettings(
  current: FloatAISettings,
  patch: DeepPartial<FloatAISettings>
): FloatAISettings {
  return normalizeSettings({
    ...current,
    ...patch,
    popup: {
      ...current.popup,
      ...(patch.popup ?? {})
    },
    clipboard: {
      ...current.clipboard,
      ...(patch.clipboard ?? {})
    },
    privacy: {
      ...current.privacy,
      ...(patch.privacy ?? {})
    },
    performance: {
      ...current.performance,
      ...(patch.performance ?? {})
    },
    providers: patch.providers ?? current.providers,
    quickAsk: {
      ...current.quickAsk,
      ...(patch.quickAsk ?? {})
    }
  });
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function clampOpacity(value: unknown, fallback: number): number {
  const numberValue = Number(value);

  if (!Number.isFinite(numberValue)) {
    return fallback;
  }

  return Math.min(1, Math.max(0.6, numberValue));
}

function isLegacyDefaultProvider(provider: Provider): boolean {
  return legacyDefaultProviderIds.has(provider.id) && legacyDefaultProviderUrls.get(provider.id) === provider.url;
}

function normalizeHotkey(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  return value.trim();
}
