import {
  Check,
  Copy,
  Edit3,
  ExternalLink,
  Monitor,
  Plus,
  Power,
  Save,
  Settings2,
  SlidersHorizontal,
  Trash2,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  createProviderId,
  isHttpUrl,
  type DeepPartial,
  type FloatAISettings,
  type Provider
} from '../../shared/settings';

type SectionId = 'general' | 'popup' | 'providers' | 'shortcuts' | 'advanced';

type ProviderDraft = {
  name: string;
  url: string;
  icon: string;
};

const sections: Array<{ id: SectionId; label: string; icon: typeof Settings2 }> = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'popup', label: 'Popup Window', icon: Monitor },
  { id: 'providers', label: 'Providers', icon: ExternalLink },
  { id: 'shortcuts', label: 'Shortcuts', icon: SlidersHorizontal },
  { id: 'advanced', label: 'Advanced', icon: Power }
];

const emptyDraft: ProviderDraft = {
  name: '',
  url: '',
  icon: ''
};

export default function SettingsWindow() {
  const [settings, setSettings] = useState<FloatAISettings | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>('general');
  const [hotkeyDraft, setHotkeyDraft] = useState('');
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyDraft);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<string>('');

  useEffect(() => {
    let mounted = true;

    window.floatAI.getSettings().then((nextSettings) => {
      if (!mounted) {
        return;
      }

      setSettings(nextSettings);
      setHotkeyDraft(nextSettings.globalHotkey);
    });

    const removeSettingsListener = window.floatAI.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
      setHotkeyDraft((current) => current || nextSettings.globalHotkey);
    });

    return () => {
      mounted = false;
      removeSettingsListener();
    };
  }, []);

  const providerById = useMemo(() => {
    return new Map(settings?.providers.map((provider) => [provider.id, provider]) ?? []);
  }, [settings?.providers]);

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

  function startAddProvider() {
    setEditingProviderId(null);
    setProviderDraft(emptyDraft);
    setProviderError('');
  }

  function startEditProvider(provider: Provider) {
    setEditingProviderId(provider.id);
    setProviderDraft({
      name: provider.name,
      url: provider.url,
      icon: provider.icon
    });
    setProviderError('');
  }

  async function saveProvider() {
    if (!settings) {
      return;
    }

    const trimmedDraft = {
      name: providerDraft.name.trim(),
      url: providerDraft.url.trim(),
      icon: providerDraft.icon.trim() || 'spark'
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
      const providers = settings.providers.map((provider) =>
        provider.id === editingProviderId
          ? {
              ...provider,
              ...trimmedDraft
            }
          : provider
      );

      await persist({ providers });
      setProviderDraft(emptyDraft);
      setEditingProviderId(null);
      setProviderError('');
      return;
    }

    const id = createUniqueProviderId(trimmedDraft.name, settings.providers);
    const providers = [
      ...settings.providers,
      {
        id,
        ...trimmedDraft
      }
    ];

    await persist({ providers });
    setProviderDraft(emptyDraft);
    setProviderError('');
  }

  async function deleteProvider(provider: Provider) {
    if (!settings || settings.providers.length <= 1) {
      return;
    }

    const providers = settings.providers.filter((item) => item.id !== provider.id);
    const patch: DeepPartial<FloatAISettings> = { providers };

    if (settings.defaultProviderId === provider.id) {
      patch.defaultProviderId = providers[0]?.id ?? 'chatgpt';
    }

    await persist(patch);
  }

  if (!settings) {
    return <div className="settings-loading">Loading settings</div>;
  }

  return (
    <div className="settings-shell">
      <aside className="settings-sidebar">
        <div className="brand-block">
          <div className="brand-mark">F</div>
          <div>
            <div className="brand-title">FloatAI</div>
            <div className="brand-subtitle">Launcher</div>
          </div>
        </div>
        <nav className="settings-nav">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                className={section.id === activeSection ? 'nav-item active' : 'nav-item'}
                onClick={() => setActiveSection(section.id)}
              >
                <Icon size={17} />
                <span>{section.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="settings-main">
        <header className="settings-header">
          <div>
            <h1>{sections.find((section) => section.id === activeSection)?.label}</h1>
            <p>FloatAI Launcher</p>
          </div>
          <button type="button" className="ghost-button" onClick={() => window.floatAI.togglePopup()}>
            Open Popup
          </button>
        </header>

        {activeSection === 'general' && (
          <section className="settings-panel">
            <FieldRow label="Default provider">
              <select
                className="input"
                value={settings.defaultProviderId}
                onChange={(event) => persist({ defaultProviderId: event.target.value })}
              >
                {settings.providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </FieldRow>
            <ToggleRow
              label="Launch at startup"
              checked={settings.launchAtStartup}
              onChange={(checked) => persist({ launchAtStartup: checked })}
            />
            <ToggleRow
              label="Show tray icon"
              checked={settings.showTrayIcon}
              onChange={(checked) => persist({ showTrayIcon: checked })}
            />
          </section>
        )}

        {activeSection === 'popup' && (
          <section className="settings-panel">
            <div className="two-column">
              <FieldRow label="Popup width">
                <NumberInput
                  value={settings.popup.width}
                  min={420}
                  max={1800}
                  onChange={(width) => patchPopup({ width })}
                />
              </FieldRow>
              <FieldRow label="Popup height">
                <NumberInput
                  value={settings.popup.height}
                  min={360}
                  max={1400}
                  onChange={(height) => patchPopup({ height })}
                />
              </FieldRow>
            </div>
            <ToggleRow
              label="Always on top"
              checked={settings.popup.alwaysOnTop}
              onChange={(alwaysOnTop) => patchPopup({ alwaysOnTop })}
            />
            <ToggleRow
              label="Remember last position"
              checked={settings.popup.rememberPosition}
              onChange={(rememberPosition) => patchPopup({ rememberPosition })}
            />
            <ToggleRow
              label="Hide when focus lost"
              checked={settings.popup.hideOnBlur}
              onChange={(hideOnBlur) => patchPopup({ hideOnBlur })}
            />
            <ReadonlyRow label="Resizable in popup" value="Off" />
          </section>
        )}

        {activeSection === 'providers' && (
          <section className="settings-panel provider-manager">
            <div className="provider-list">
              {settings.providers.map((provider) => (
                <div className="provider-row" key={provider.id}>
                  <div className="provider-icon">{provider.icon.slice(0, 2).toUpperCase()}</div>
                  <div className="provider-meta">
                    <strong>{provider.name}</strong>
                    <span>{provider.url}</span>
                  </div>
                  {settings.defaultProviderId === provider.id && (
                    <span className="default-badge">
                      <Check size={13} />
                      Default
                    </span>
                  )}
                  <button type="button" className="icon-button soft" onClick={() => startEditProvider(provider)}>
                    <Edit3 size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-button danger"
                    onClick={() => deleteProvider(provider)}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <div className="provider-form">
              <div className="form-title">
                <span>{editingProviderId ? `Edit ${providerById.get(editingProviderId)?.name ?? 'provider'}` : 'Add Provider'}</span>
                {editingProviderId && (
                  <button type="button" className="icon-button soft" onClick={startAddProvider}>
                    <X size={16} />
                  </button>
                )}
              </div>
              <FieldRow label="Name">
                <input
                  className="input"
                  value={providerDraft.name}
                  onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })}
                  placeholder="Custom AI"
                />
              </FieldRow>
              <FieldRow label="URL">
                <input
                  className="input"
                  value={providerDraft.url}
                  onChange={(event) => setProviderDraft({ ...providerDraft, url: event.target.value })}
                  placeholder="https://example.com"
                />
              </FieldRow>
              <FieldRow label="Icon string">
                <input
                  className="input"
                  value={providerDraft.icon}
                  onChange={(event) => setProviderDraft({ ...providerDraft, icon: event.target.value })}
                  placeholder="spark"
                />
              </FieldRow>
              {providerError && <div className="form-error">{providerError}</div>}
              <button type="button" className="primary-button" onClick={saveProvider}>
                {editingProviderId ? <Save size={16} /> : <Plus size={16} />}
                {editingProviderId ? 'Save Provider' : 'Add Provider'}
              </button>
            </div>
          </section>
        )}

        {activeSection === 'shortcuts' && (
          <section className="settings-panel">
            <FieldRow label="Global hotkey">
              <div className="inline-control">
                <input
                  className="input"
                  value={hotkeyDraft}
                  onChange={(event) => setHotkeyDraft(event.target.value)}
                  placeholder="CommandOrControl+Space"
                />
                <button
                  type="button"
                  className="primary-button compact"
                  onClick={() => persist({ globalHotkey: hotkeyDraft.trim() || settings.globalHotkey })}
                >
                  <Save size={16} />
                  Save
                </button>
              </div>
            </FieldRow>
          </section>
        )}

        {activeSection === 'advanced' && (
          <section className="settings-panel">
            <ToggleRow
              label="Copy selected text before open"
              checked={settings.clipboard.copySelectedTextBeforeOpen}
              onChange={(copySelectedTextBeforeOpen) =>
                persist({
                  clipboard: {
                    copySelectedTextBeforeOpen
                  }
                })
              }
            />
            <ToggleRow
              label="Auto paste"
              checked={settings.clipboard.autoPaste}
              onChange={(autoPaste) =>
                persist({
                  clipboard: {
                    autoPaste
                  }
                })
              }
            />
            <ReadonlyRow label="Settings store" value="electron-store" />
            <ReadonlyRow label="Embedded AI pages" value="Electron webview" icon={<Copy size={15} />} />
          </section>
        )}
      </main>
    </div>
  );
}

function FieldRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="field-row">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ReadonlyRow({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="readonly-row">
      <span>{label}</span>
      <strong>
        {icon}
        {value}
      </strong>
    </div>
  );
}

function ToggleRow({
  checked,
  label,
  onChange
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="toggle-row">
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

function NumberInput({
  max,
  min,
  onChange,
  value
}: {
  max: number;
  min: number;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
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
