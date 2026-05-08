import {
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ImagePlus,
  Plus,
  Save,
  Settings,
  Trash2,
  X
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  createProviderId,
  isHttpUrl,
  type DeepPartial,
  type FloatAISettings,
  type Provider
} from '../../shared/settings';
import type { WebviewNavigationDirection } from '../../shared/bridge';

type SettingsTab = 'window' | 'providers' | 'shortcut';

type ProviderDraft = {
  name: string;
  url: string;
  icon: string;
};

type WebviewElement = HTMLElement & {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  goBack: () => void;
  goForward: () => void;
};

const emptyProviderDraft: ProviderDraft = {
  name: '',
  url: '',
  icon: ''
};

export default function PopupWindow() {
  const [settings, setSettings] = useState<FloatAISettings | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string>('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('window');
  const [loadingByProvider, setLoadingByProvider] = useState<Record<string, boolean>>({});
  const [hotkeyDraft, setHotkeyDraft] = useState('');
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyProviderDraft);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [providerIconUrls, setProviderIconUrls] = useState<Record<string, string>>({});
  const [draftIconUrl, setDraftIconUrl] = useState('');
  const [isResizingMode, setIsResizingMode] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);
  const webviewRefs = useRef<Record<string, WebviewElement | null>>({});
  const providerStripRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });
  const [isVisible, setIsVisible] = useState(false);

  const checkStripScroll = useCallback(() => {
    if (!providerStripRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = providerStripRef.current;
    setScrollState({
      left: scrollLeft > 0,
      right: Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1
    });
  }, []);

  useEffect(() => {
    checkStripScroll();
    window.addEventListener('resize', checkStripScroll);
    return () => window.removeEventListener('resize', checkStripScroll);
  }, [checkStripScroll, settings?.providers]);

  useEffect(() => {
    let mounted = true;

    window.floatAI.getSettings().then((nextSettings) => {
      if (!mounted) {
        return;
      }

      setSettings(nextSettings);
      setSelectedProviderId(nextSettings.defaultProviderId);
      setHotkeyDraft(nextSettings.globalHotkey);
    });

    const removeSettingsListener = window.floatAI.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
      setHotkeyDraft((current) => current || nextSettings.globalHotkey);
      setSelectedProviderId((current) =>
        nextSettings.providers.some((provider) => provider.id === current) ? current : nextSettings.defaultProviderId
      );
    });

    const removeProviderListener = window.floatAI.onProviderChanged((provider) => {
      setSelectedProviderId(provider.id);
    });

    const removeOpenSettingsListener = window.floatAI.onOpenSettingsRequested(() => {
      setSettingsOpen(true);
      setSettingsTab('window');
    });

    const removeNavigationListener = window.floatAI.onWebviewNavigation((direction) => {
      navigateWebview(direction);
    });

    const removeAnimateListener = window.floatAI.onAnimate((state) => {
      setIsVisible(state === 'in');
    });

    const removeReloadListener = window.floatAI.onReloadAllWebviews(() => {
      for (const webview of Object.values(webviewRefs.current)) {
        if (webview && typeof (webview as any).reload === 'function') {
          (webview as any).reload();
        }
      }
    });

    const handleMouseNavigation = (event: MouseEvent) => {
      if (event.button === 3) {
        event.preventDefault();
        navigateWebview('back');
      }

      if (event.button === 4) {
        event.preventDefault();
        navigateWebview('forward');
      }
    };

    window.addEventListener('mouseup', handleMouseNavigation);

    return () => {
      mounted = false;
      removeSettingsListener();
      removeProviderListener();
      removeOpenSettingsListener();
      removeNavigationListener();
      removeAnimateListener();
      removeReloadListener();
      window.removeEventListener('mouseup', handleMouseNavigation);
    };
  }, []);

  const selectedProvider = useMemo<Provider | undefined>(() => {
    if (!settings) {
      return undefined;
    }

    return (
      settings.providers.find((provider) => provider.id === selectedProviderId) ??
      settings.providers.find((provider) => provider.id === settings.defaultProviderId) ??
      settings.providers[0]
    );
  }, [selectedProviderId, settings]);

  const providerIconSignature =
    settings?.providers.map((provider) => `${provider.id}:${provider.icon}`).join('|') ?? '';

  useEffect(() => {
    if (!settings) {
      return;
    }

    let cancelled = false;

    Promise.all(
      settings.providers.map(async (provider) => {
        const url = await window.floatAI.resolveProviderIcon(provider.icon);
        return [provider.id, url] as const;
      })
    ).then((entries) => {
      if (!cancelled) {
        setProviderIconUrls(Object.fromEntries(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [providerIconSignature, settings]);

  useEffect(() => {
    let cancelled = false;

    if (!providerDraft.icon.trim()) {
      setDraftIconUrl('');
      return;
    }

    window.floatAI.resolveProviderIcon(providerDraft.icon).then((url) => {
      if (!cancelled) {
        setDraftIconUrl(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [providerDraft.icon]);

  async function persist(patch: DeepPartial<FloatAISettings>) {
    const nextSettings = await window.floatAI.updateSettings(patch);
    setSettings(nextSettings);
    return nextSettings;
  }

  function patchPopup(patch: DeepPartial<FloatAISettings>['popup']) {
    return persist({
      popup: patch
    });
  }

  async function handleProviderChange(providerId: string) {
    setSelectedProviderId(providerId);
    setSettingsOpen(false);
    await window.floatAI.switchProvider(providerId);
  }

  function navigateWebview(direction: WebviewNavigationDirection) {
    const webview = webviewRefs.current[selectedProviderId];

    if (!webview) {
      return;
    }

    if (direction === 'back' && webview.canGoBack()) {
      webview.goBack();
    }

    if (direction === 'forward' && webview.canGoForward()) {
      webview.goForward();
    }
  }

  function startAddProvider() {
    setEditingProviderId(null);
    setProviderDraft(emptyProviderDraft);
    setDraftIconUrl('');
    setProviderError('');
    setProviderFormOpen(true);
  }

  function startEditProvider(provider: Provider) {
    setEditingProviderId(provider.id);
    setProviderDraft({
      name: provider.name,
      url: provider.url,
      icon: provider.icon
    });
    setProviderError('');
    setProviderFormOpen(true);
  }

  async function pickIconForDraft() {
    const pickedIcon = await window.floatAI.pickProviderIcon();

    if (!pickedIcon) {
      return;
    }

    setProviderDraft((currentDraft) => ({
      ...currentDraft,
      icon: pickedIcon.icon
    }));
    setDraftIconUrl(pickedIcon.url);
  }

  async function saveProvider() {
    if (!settings) {
      return;
    }

    const trimmedDraft = {
      name: providerDraft.name.trim(),
      url: providerDraft.url.trim(),
      icon: providerDraft.icon.trim() || providerDraft.name.trim().toLowerCase()
    };

    if (!trimmedDraft.name) {
      setProviderError('Name is required.');
      return;
    }

    if (!isHttpUrl(trimmedDraft.url)) {
      setProviderError('Use an http or https URL.');
      return;
    }

    if (editingProviderId) {
      await persist({
        providers: settings.providers.map((provider) =>
          provider.id === editingProviderId
            ? {
                ...provider,
                ...trimmedDraft
              }
            : provider
        )
      });
      closeProviderForm();
      return;
    }

    const newProvider = {
      id: createUniqueProviderId(trimmedDraft.name, settings.providers),
      ...trimmedDraft
    };

    await persist({
      providers: [...settings.providers, newProvider],
      defaultProviderId: settings.defaultProviderId || newProvider.id
    });
    setProviderDraft(emptyProviderDraft);
    setProviderError('');
    setProviderFormOpen(false);
  }

  async function performDeleteProvider() {
    if (!settings || !providerToDelete) {
      return;
    }

    const providerId = providerToDelete;
    const providers = settings.providers.filter((provider) => provider.id !== providerId);
    const fallbackProvider = providers[0];
    const shouldMoveSelection = selectedProviderId === providerId;
    const defaultProviderId = settings.defaultProviderId === providerId ? fallbackProvider.id : settings.defaultProviderId;

    const nextSettings = await persist({
      providers,
      defaultProviderId
    });

    if (shouldMoveSelection) {
      setSelectedProviderId(defaultProviderId);
      await window.floatAI.switchProvider(defaultProviderId);
    }

    if (editingProviderId === providerId) {
      closeProviderForm();
    }

    setSettings(nextSettings);
    setProviderError('');
    setProviderToDelete(null);
  }

  function requestDeleteProvider(providerId: string) {
    if (!settings) {
      return;
    }

    if (settings.providers.length <= 1) {
      setProviderError('Keep at least one provider.');
      return;
    }

    setProviderToDelete(providerId);
  }

  function closeProviderForm() {
    setEditingProviderId(null);
    setProviderDraft(emptyProviderDraft);
    setDraftIconUrl('');
    setProviderError('');
    setProviderFormOpen(false);
  }

  function setWebviewRef(providerId: string, element: WebviewElement | null) {
    const existingWebview = webviewRefs.current[providerId];

    if (existingWebview === element) {
      return;
    }

    webviewRefs.current[providerId] = element;

    if (!element) {
      return;
    }

    const setProviderLoading = (loading: boolean) => {
      setLoadingByProvider((current) => ({
        ...current,
        [providerId]: loading
      }));
    };

    element.addEventListener('did-start-loading', () => setProviderLoading(true));
    element.addEventListener('did-stop-loading', () => setProviderLoading(false));
    element.addEventListener('did-fail-load', () => setProviderLoading(false));
  }

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!settings) return;

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    let currentWidth = settings.popup.width;
    let currentHeight = settings.popup.height;
    let lastScreenX = e.screenX;
    let lastScreenY = e.screenY;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.screenX - lastScreenX;
      const deltaY = moveEvent.screenY - lastScreenY;
      lastScreenX = moveEvent.screenX;
      lastScreenY = moveEvent.screenY;

      currentWidth = Math.max(420, Math.min(1800, currentWidth + deltaX));
      currentHeight = Math.max(360, Math.min(1400, currentHeight + deltaY));
      window.floatAI.resizePopupInteractive({ width: currentWidth, height: currentHeight });
    };

    const onPointerUp = (upEvent: PointerEvent) => {
      target.releasePointerCapture(upEvent.pointerId);
      target.removeEventListener('pointermove', onPointerMove);
      target.removeEventListener('pointerup', onPointerUp);
      patchPopup({ width: currentWidth, height: currentHeight });
    };

    target.addEventListener('pointermove', onPointerMove);
    target.addEventListener('pointerup', onPointerUp);
  };

  if (!settings || !selectedProvider) {
    return (
      <div className="popup-shell">
        <div className="popup-toolbar">
          <div className="provider-strip" />
        </div>
        <div className="loading-surface">Loading</div>
      </div>
    );
  }

  const targetOpacity = isVisible ? settings.popup.opacity : 0;

  const chromeStyle = {
    '--chrome-opacity': '1',
    opacity: targetOpacity,
    transition: 'opacity 0.1s ease',
    pointerEvents: isVisible ? 'auto' : 'none'
  } as CSSProperties;

  return (
    <div className="popup-shell" style={chromeStyle}>
      {isResizingMode && (
        <div className="resize-preview-mode no-drag">
          <div className="resize-message">
            <h2>Resize Window</h2>
            <p>Drag the bottom right corner to resize</p>
            <button className="primary-button" type="button" onClick={() => setIsResizingMode(false)}>
              <Check size={16} />
              Done
            </button>
          </div>
          <div className="resize-handle" onPointerDown={handleResizePointerDown}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="21 15 21 21 15 21"></polyline>
              <line x1="21" y1="21" x2="15" y2="15"></line>
            </svg>
          </div>
        </div>
      )}
      <header className="popup-toolbar">
        <div className={`provider-strip-wrapper ${scrollState.left ? 'mask-left' : ''} ${scrollState.right ? 'mask-right' : ''}`}>
          <div className="provider-strip" aria-label="Providers" ref={providerStripRef} onScroll={checkStripScroll}>
            {settings.providers.map((provider) => (
              <button
                key={provider.id}
                type="button"
                className={provider.id === selectedProvider.id ? 'provider-pill active' : 'provider-pill'}
                onClick={() => handleProviderChange(provider.id)}
                title={provider.url}
              >
                <ProviderLogo provider={provider} iconUrl={providerIconUrls[provider.id]} />
                <span>{provider.name}</span>
              </button>
            ))}
          </div>
        </div>
        <button
          className={settingsOpen ? 'icon-button no-drag active' : 'icon-button no-drag'}
          type="button"
          onClick={() => setSettingsOpen((open) => !open)}
          title="Settings"
        >
          <Settings size={17} />
        </button>
        <button className="icon-button no-drag close-button" type="button" onClick={() => window.floatAI.hidePopup()} title="Hide">
          <X size={18} />
        </button>
      </header>
      {loadingByProvider[selectedProvider.id] && <div className="webview-progress" />}
      <main className="popup-content">
        <div className="webview-stack">
          {settings.providers.map((provider) => (
            <webview
              key={provider.id}
              ref={(element) => setWebviewRef(provider.id, element as WebviewElement | null)}
              className={provider.id === selectedProvider.id ? 'provider-webview active' : 'provider-webview'}
              src={provider.url}
              partition="persist:floatai-sites"
              allowpopups
            />
          ))}
        </div>

        {settingsOpen && (
          <aside className="settings-drawer no-drag">
            <div className="drawer-header">
              <div>
                <h1>Settings</h1>
              </div>
              <button className="icon-button" type="button" onClick={() => setSettingsOpen(false)} title="Close settings">
                <X size={18} />
              </button>
            </div>

            <div className="drawer-tabs">
              <button
                type="button"
                className={settingsTab === 'window' ? 'drawer-tab active' : 'drawer-tab'}
                onClick={() => setSettingsTab('window')}
              >
                Window
              </button>
              <button
                type="button"
                className={settingsTab === 'providers' ? 'drawer-tab active' : 'drawer-tab'}
                onClick={() => setSettingsTab('providers')}
              >
                Providers
              </button>
              <button
                type="button"
                className={settingsTab === 'shortcut' ? 'drawer-tab active' : 'drawer-tab'}
                onClick={() => setSettingsTab('shortcut')}
              >
                Shortcut
              </button>
            </div>

            {settingsTab === 'window' && (
              <div className="drawer-section">
                <div className="compact-field">
                  <span>Window Size</span>
                  <div className="inline-control">
                    <span style={{ color: '#edf1f3', fontSize: 13, lineHeight: '36px' }}>
                      {settings.popup.width} &times; {settings.popup.height}
                    </span>
                    <button className="primary-button compact" type="button" onClick={() => setIsResizingMode(true)}>
                      <Edit3 size={16} />
                      Resize
                    </button>
                  </div>
                </div>
                <CompactSliderRow
                  label="Transparency"
                  value={Math.round(settings.popup.opacity * 100)}
                  min={60}
                  max={100}
                  suffix="%"
                  onChange={(opacity) => patchPopup({ opacity: opacity / 100 })}
                />
                <CompactToggleRow
                  label="Always on top"
                  checked={settings.popup.alwaysOnTop}
                  onChange={(alwaysOnTop) => patchPopup({ alwaysOnTop })}
                />
                <CompactToggleRow
                  label="Remember position"
                  checked={settings.popup.rememberPosition}
                  onChange={(rememberPosition) => patchPopup({ rememberPosition })}
                />
                <CompactToggleRow
                  label="Hide on blur"
                  checked={settings.popup.hideOnBlur}
                  onChange={(hideOnBlur) => patchPopup({ hideOnBlur })}
                />
                <CompactToggleRow
                  label="Tray icon"
                  checked={settings.showTrayIcon}
                  onChange={(showTrayIcon) => persist({ showTrayIcon })}
                />
                <CompactToggleRow
                  label="Startup"
                  checked={settings.launchAtStartup}
                  onChange={(launchAtStartup) => persist({ launchAtStartup })}
                />
                <div style={{ marginTop: '8px', padding: '12px', background: 'rgba(255, 255, 255, 0.03)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
                  <CompactToggleRow
                    label="Privacy Capture Protection"
                    checked={settings.privacy?.captureProtection ?? false}
                    onChange={(captureProtection) => persist({ privacy: { captureProtection } })}
                  />
                  <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#8c9ba3', lineHeight: '1.4' }}>
                    Hides FloatAI from screenshots and screen sharing where supported <strong style={{color: '#52d273'}}>(FULLY UNDETECTABLE)</strong>. Works best on Windows 10 2004+ and Windows 11. Support may vary by app and OS.
                  </p>
                </div>
              </div>
            )}

            {settingsTab === 'providers' && (
              <div className="drawer-section provider-drawer">
                <div className="compact-provider-list">
                  {settings.providers.map((provider) => (
                    <div className="compact-provider-row" key={provider.id}>
                      <ProviderLogo provider={provider} iconUrl={providerIconUrls[provider.id]} />
                      <button
                        type="button"
                        className="provider-name-button"
                        onClick={() => persist({ defaultProviderId: provider.id })}
                        title="Set default"
                      >
                        <strong>{provider.name}</strong>
                        <span>{provider.url}</span>
                      </button>
                      {settings.defaultProviderId === provider.id ? <Check className="default-check" size={16} /> : <div />}
                      <button className="icon-button soft" type="button" onClick={() => startEditProvider(provider)} title="Edit">
                        <Edit3 size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        type="button"
                        onClick={() => requestDeleteProvider(provider.id)}
                        title="Remove"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  ))}
                </div>
                <button className="add-provider-button" type="button" onClick={startAddProvider}>
                  <Plus size={16} />
                  Add provider
                </button>
              </div>
            )}

            {settingsTab === 'shortcut' && (
              <div className="drawer-section">
                <div className="compact-field">
                  <span>Global hotkey</span>
                  <div className="inline-control">
                    <input
                      className="input"
                      value={hotkeyDraft}
                      onChange={(event) => setHotkeyDraft(event.target.value)}
                      placeholder="F20"
                    />
                    <button
                      className="primary-button compact"
                      type="button"
                      onClick={() => persist({ globalHotkey: hotkeyDraft.trim() || settings.globalHotkey })}
                    >
                      <Save size={16} />
                      Save
                    </button>
                  </div>
                </div>
                <CompactToggleRow
                  label="Ctrl +/- to zoom"
                  checked={settings.enableZoomShortcuts}
                  onChange={(enableZoomShortcuts) => persist({ enableZoomShortcuts })}
                />
              </div>
            )}

            {providerFormOpen && (
              <div className="provider-form-overlay">
                <div className="mini-form-header">
                  <strong>{editingProviderId ? 'Edit Provider' : 'Add Provider'}</strong>
                  <button className="icon-button soft" type="button" onClick={closeProviderForm} title="Cancel">
                    <X size={18} />
                  </button>
                </div>
                <div className="provider-form-content">
                  <div>
                    <label className="field-label">Provider Name</label>
                    <input
                      className="input"
                      value={providerDraft.name}
                      onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
                      placeholder="e.g. ChatGPT"
                    />
                  </div>
                  <div>
                    <label className="field-label">Provider URL</label>
                    <input
                      className="input"
                      value={providerDraft.url}
                      onChange={(event) => setProviderDraft({ ...providerDraft, url: event.target.value })}
                      placeholder="https://chatgpt.com"
                    />
                  </div>
                  <div>
                    <label className="field-label">Icon</label>
                    <div className="icon-picker-row">
                      <ProviderLogo
                        provider={{
                          id: 'draft',
                          name: providerDraft.name || 'Provider',
                          url: providerDraft.url || 'https://example.com',
                          icon: providerDraft.icon
                        }}
                        iconUrl={draftIconUrl}
                      />
                      <input
                        className="input"
                        value={providerDraft.icon}
                        onChange={(event) => setProviderDraft({ ...providerDraft, icon: event.target.value })}
                        placeholder="Icon key or PNG file"
                      />
                      <button className="icon-pick-button" type="button" onClick={pickIconForDraft}>
                        <ImagePlus size={18} />
                        PNG
                      </button>
                    </div>
                  </div>
                  {providerError && <div className="form-error">{providerError}</div>}
                </div>
                <button className="primary-button" type="button" onClick={saveProvider}>
                  {editingProviderId ? <Save size={18} /> : <Plus size={18} />}
                  {editingProviderId ? 'Save Changes' : 'Add Provider'}
                </button>
              </div>
            )}

            {providerToDelete && (
              <div className="provider-form-overlay">
                <div className="mini-form-header">
                  <strong>Delete Provider?</strong>
                  <button className="icon-button soft" type="button" onClick={() => setProviderToDelete(null)} title="Cancel">
                    <X size={18} />
                  </button>
                </div>
                <div className="provider-form-content">
                  <p style={{ color: '#dce3e6', fontSize: '15px', lineHeight: '1.5' }}>
                    Are you sure you want to remove this provider? This action cannot be undone.
                  </p>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: 'auto' }}>
                  <button className="primary-button" style={{ background: 'rgba(255, 255, 255, 0.08)', color: '#fff' }} type="button" onClick={() => setProviderToDelete(null)}>
                    Cancel
                  </button>
                  <button className="primary-button" style={{ background: 'rgba(255, 95, 82, 0.2)', color: '#ffb2aa' }} type="button" onClick={performDeleteProvider}>
                    <Trash2 size={18} />
                    Delete
                  </button>
                </div>
              </div>
            )}
          </aside>
        )}
      </main>
    </div>
  );
}

function ProviderLogo({ iconUrl, provider }: { iconUrl?: string; provider: Provider }) {
  const iconKey = provider.icon.trim().toLowerCase();
  const knownClass = !iconUrl && ['chatgpt', 'claude', 'gemini', 'perplexity', 'copilot'].includes(iconKey)
    ? ` logo-${iconKey}`
    : '';
  const initials = provider.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className={`provider-logo${knownClass}`} aria-hidden="true">
      {iconUrl ? (
        <img src={iconUrl} alt="" draggable={false} />
      ) : (
        <span>{iconKey === 'chatgpt' ? '' : initials || provider.icon.slice(0, 2).toUpperCase()}</span>
      )}
    </span>
  );
}

function CompactNumberRow({
  label,
  max,
  min,
  onChange,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => {
          const numberValue = Number(event.target.value);

          if (Number.isFinite(numberValue)) {
            onChange(Math.min(max, Math.max(min, Math.round(numberValue))));
          }
        }}
      />
    </label>
  );
}

function CompactSliderRow({
  label,
  max,
  min,
  onChange,
  suffix,
  value
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  suffix: string;
  value: number;
}) {
  return (
    <label className="compact-field">
      <span>{label}</span>
      <div className="slider-control">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <strong>
          {value}
          {suffix}
        </strong>
      </div>
    </label>
  );
}

function CompactToggleRow({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="compact-toggle-row">
      <span>{label}</span>
      <button
        type="button"
        className={checked ? 'toggle active' : 'toggle'}
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
      >
        <span />
      </button>
    </div>
  );
}

function createUniqueProviderId(name: string, providers: Provider[]): string {
  const baseId = createProviderId(name);
  const existingIds = new Set(providers.map((provider) => provider.id));

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  let nextId = `${baseId}-${suffix}`;

  while (existingIds.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}-${suffix}`;
  }

  return nextId;
}
