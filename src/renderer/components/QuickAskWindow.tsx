import { ChevronDown, Send, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  isQuickAskProvider,
  quickAskProviderIds,
  type DeepPartial,
  type FloatAISettings,
  type Provider
} from '../../shared/settings';

export default function QuickAskWindow() {
  const [settings, setSettings] = useState<FloatAISettings | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('chatgpt');
  const [prompt, setPrompt] = useState('');
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [providerIconUrls, setProviderIconUrls] = useState<Record<string, string>>({});
  const [isVisible, setIsVisible] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = window.floatAI.platform === 'darwin';

  useEffect(() => {
    let mounted = true;

    window.floatAI.getSettings().then((nextSettings) => {
      if (!mounted) {
        return;
      }

      setSettings(nextSettings);
      setSelectedProviderId(resolveSelectedProviderId(nextSettings));
      requestAnimationFrame(() => inputRef.current?.focus());
    });

    const removeSettingsListener = window.floatAI.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
      setSelectedProviderId((current) =>
        supportedProviders(nextSettings).some((provider) => provider.id === current)
          ? current
          : resolveSelectedProviderId(nextSettings)
      );
    });

    const removeAnimateListener = window.floatAI.onQuickAskAnimate((state) => {
      setIsVisible(state === 'in');
      if (state === 'in') {
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    });

    return () => {
      mounted = false;
      removeSettingsListener();
      removeAnimateListener();
    };
  }, []);

  const providers = useMemo(() => (settings ? supportedProviders(settings) : []), [settings]);
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const providerIconSignature = providers.map((provider) => `${provider.id}:${provider.icon}`).join('|');

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      providers.map(async (provider) => {
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
  }, [providerIconSignature]);

  async function persist(patch: DeepPartial<FloatAISettings>) {
    const nextSettings = await window.floatAI.updateSettings(patch);
    setSettings(nextSettings);
    return nextSettings;
  }

  async function selectProvider(provider: Provider) {
    setSelectedProviderId(provider.id);
    setProviderMenuOpen(false);
    await persist({
      quickAsk: {
        providerId: provider.id
      }
    });
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  async function submitQuickAsk() {
    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt || !selectedProvider || isSubmitting) {
      return;
    }

    setIsSubmitting(true);

    try {
      await window.floatAI.submitQuickAsk({
        providerId: selectedProvider.id,
        prompt: trimmedPrompt
      });
      setPrompt('');
      setProviderMenuOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.floatAI.hideQuickAsk().catch(() => undefined);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void submitQuickAsk();
      return;
    }

    const providerNumber = Number(event.key);
    const modifierPressed = isMac ? event.metaKey : event.altKey;

    if (modifierPressed && providerNumber >= 1 && providerNumber <= providers.length) {
      event.preventDefault();
      void selectProvider(providers[providerNumber - 1]);
    }
  }

  if (!settings) {
    return <div className="quick-ask-root" />;
  }

  if (!selectedProvider) {
    return (
      <div className={`quick-ask-root ${settings.darkMode ? 'dark-theme' : 'light-theme'} ${isVisible ? 'visible' : ''}`}>
        <div className="quick-ask-shell quick-ask-unavailable">
          <span className="quick-ask-unavailable-message">
            Add ChatGPT, Claude, or Gemini in Providers to use Quick Ask.
          </span>
          <button
            className="quick-ask-clear"
            type="button"
            onClick={() => window.floatAI.hideQuickAsk().catch(() => undefined)}
            aria-label="Close"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`quick-ask-root ${settings.darkMode ? 'dark-theme' : 'light-theme'} ${isVisible ? 'visible' : ''}`}>
      <div className={providerMenuOpen ? 'quick-ask-shell menu-open' : 'quick-ask-shell'}>
        <button
          className="quick-ask-provider"
          type="button"
          onClick={() => setProviderMenuOpen((open) => !open)}
          aria-label={`Use ${selectedProvider.name}`}
          title={selectedProvider.name}
        >
          <ProviderLogo provider={selectedProvider} iconUrl={providerIconUrls[selectedProvider.id]} />
          <ChevronDown size={16} />
        </button>
        <input
          ref={inputRef}
          className="quick-ask-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask anything"
          spellCheck={false}
        />
        {prompt && (
          <button
            className="quick-ask-clear"
            type="button"
            onClick={() => {
              setPrompt('');
              inputRef.current?.focus();
            }}
            aria-label="Clear"
            title="Clear"
          >
            <X size={16} />
          </button>
        )}
        <button
          className="quick-ask-send"
          type="button"
          onClick={() => void submitQuickAsk()}
          disabled={!prompt.trim() || isSubmitting}
          aria-label="Send"
          title="Send"
        >
          <Send size={18} />
        </button>
        {providerMenuOpen && (
          <div className="quick-ask-provider-menu" role="menu">
            {providers.map((provider) => (
              <button
                key={provider.id}
                className={provider.id === selectedProvider.id ? 'quick-ask-provider-option active' : 'quick-ask-provider-option'}
                type="button"
                onClick={() => void selectProvider(provider)}
                role="menuitem"
              >
                <ProviderLogo provider={provider} iconUrl={providerIconUrls[provider.id]} />
                <span>{provider.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function supportedProviders(settings: FloatAISettings): Provider[] {
  const providers = settings.providers.filter((provider) => isQuickAskProvider(provider.id));
  return quickAskProviderIds
    .map((providerId) => providers.find((provider) => provider.id === providerId))
    .filter((provider): provider is Provider => Boolean(provider));
}

function resolveSelectedProviderId(settings: FloatAISettings): string {
  const providers = supportedProviders(settings);
  return (
    providers.find((provider) => provider.id === settings.quickAsk.providerId)?.id ??
    providers.find((provider) => provider.id === settings.defaultProviderId)?.id ??
    providers[0]?.id ??
    settings.providers[0]?.id ??
    'chatgpt'
  );
}

function ProviderLogo({ iconUrl, provider }: { iconUrl?: string; provider: Provider }) {
  const iconKey = provider.icon.trim().toLowerCase();
  const knownClass = !iconUrl && ['chatgpt', 'claude', 'gemini'].includes(iconKey) ? ` logo-${iconKey}` : '';
  const initials = provider.name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className={`provider-logo${knownClass}`} aria-hidden="true">
      {iconUrl ? <img src={iconUrl} alt="" draggable={false} /> : <span>{initials || provider.icon.slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}
