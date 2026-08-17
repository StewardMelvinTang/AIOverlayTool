import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AlertCircle, Check, ChevronLeft, Copy, Download, X } from 'lucide-react';
import type { FloatAISettings } from '../../shared/settings';
import type { ProviderBrowserState } from '../../shared/bridge';

const initialBrowserState: ProviderBrowserState = {
  navigation: {
    url: '',
    title: 'Loading…',
    canGoBack: false,
    isLoading: true
  },
  download: {
    status: 'idle',
    filename: '',
    receivedBytes: 0,
    totalBytes: 0,
    percent: null,
    activeCount: 0,
    canReveal: false
  }
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export default function ProviderBrowserWindow() {
  const [browserState, setBrowserState] = useState(initialBrowserState);
  const [darkMode, setDarkMode] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let mounted = true;

    window.floatAI.getProviderBrowserState().then((state) => {
      if (mounted && state) {
        setBrowserState(state);
      }
    }).catch(() => {
      // The next pushed state will populate the toolbar.
    });

    window.floatAI.getSettings().then((settings) => {
      if (mounted) {
        setDarkMode(settings.darkMode);
      }
    }).catch(() => {
      // Keep the dark default if settings are temporarily unavailable.
    });

    const removeBrowserListener = window.floatAI.onProviderBrowserStateChanged(setBrowserState);
    const removeSettingsListener = window.floatAI.onSettingsChanged((settings: FloatAISettings) => {
      setDarkMode(settings.darkMode);
    });

    return () => {
      mounted = false;
      removeBrowserListener();
      removeSettingsListener();
    };
  }, []);

  useEffect(() => {
    setCopied(false);
  }, [browserState.navigation.url]);

  const downloadTitle = useMemo(() => {
    const download = browserState.download;

    if (download.status === 'idle') {
      return 'Download progress';
    }

    if (download.status === 'completed') {
      return download.filename ? `Show ${download.filename} in folder` : 'Show downloaded file in folder';
    }

    if (download.status === 'cancelled') {
      return 'Download cancelled';
    }

    if (download.status === 'interrupted') {
      return 'Download interrupted';
    }

    const progress = download.percent === null ? '' : ` · ${Math.round(download.percent)}%`;
    const size = download.totalBytes > 0
      ? ` · ${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}`
      : download.receivedBytes > 0
        ? ` · ${formatBytes(download.receivedBytes)}`
        : '';
    return `${download.filename || 'Downloading'}${progress}${size}`;
  }, [browserState.download]);

  const progressStyle = {
    '--browser-download-progress': `${Math.max(0, Math.min(100, browserState.download.percent ?? 0))}`
  } as CSSProperties;

  const handleCopy = async () => {
    const didCopy = await window.floatAI.copyProviderBrowserUrl().catch(() => false);
    if (!didCopy) {
      return;
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  const handleDownloadClick = () => {
    if (browserState.download.canReveal) {
      window.floatAI.revealProviderBrowserDownload().catch(() => false);
    }
  };

  const downloadIsActive = ['starting', 'progressing', 'paused'].includes(browserState.download.status);
  const downloadIsIndeterminate = downloadIsActive && browserState.download.percent === null;
  const downloadFailed = browserState.download.status === 'interrupted';

  return (
    <div className={`provider-browser-shell ${darkMode ? 'dark-theme' : 'light-theme'}`}>
      <header className="provider-browser-toolbar">
        <button
          type="button"
          className="provider-browser-action provider-browser-close no-drag"
          aria-label="Close browser"
          title="Close browser"
          onClick={() => window.floatAI.closeProviderBrowser()}
        >
          <X size={18} strokeWidth={1.9} />
        </button>

        <button
          type="button"
          className="provider-browser-action no-drag"
          aria-label="Go back"
          title="Back"
          disabled={!browserState.navigation.canGoBack}
          onClick={() => window.floatAI.providerBrowserBack()}
        >
          <ChevronLeft size={19} strokeWidth={2} />
        </button>

        <div className={`provider-browser-address no-drag ${browserState.navigation.isLoading ? 'loading' : ''}`}>
          <input
            aria-label="Current page address"
            readOnly
            spellCheck={false}
            value={browserState.navigation.url}
            title={browserState.navigation.url}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="provider-browser-copy"
            aria-label="Copy link"
            title={copied ? 'Copied' : 'Copy link'}
            disabled={!browserState.navigation.url}
            onClick={handleCopy}
          >
            {copied ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={1.9} />}
          </button>
        </div>

        <button
          type="button"
          className={`provider-browser-download no-drag ${downloadIsActive ? 'active' : ''} ${downloadIsIndeterminate ? 'indeterminate' : ''} ${downloadFailed ? 'failed' : ''}`}
          aria-label={downloadTitle}
          title={downloadTitle}
          disabled={!browserState.download.canReveal && !downloadIsActive}
          onClick={handleDownloadClick}
          style={progressStyle}
        >
          <span className="provider-browser-download-ring" aria-hidden="true" />
          {browserState.download.status === 'completed'
            ? <Check size={17} strokeWidth={2.2} />
            : downloadFailed
              ? <AlertCircle size={17} strokeWidth={2} />
              : <Download size={17} strokeWidth={1.9} />}
          {downloadIsActive && browserState.download.percent !== null && (
            <span className="provider-browser-download-percent">{Math.round(browserState.download.percent)}</span>
          )}
        </button>
      </header>
    </div>
  );
}
