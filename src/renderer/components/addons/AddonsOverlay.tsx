import {
  ArrowLeft,
  Check,
  Download,
  Gauge,
  PackageCheck,
  PackagePlus,
  ShieldCheck,
  StickyNote,
  X
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { AddonDownloadTask, AddonManifest, AddonStorageState } from '../../../shared/addons';
import { getAvailableAddonManifests } from '../../../shared/addonsRegistry';
import ScratchPadPanel from './ScratchPadPanel';
import SpeedTestPanel from './SpeedTestPanel';

type AddonsTab = 'marketplace' | 'installed';

type AddonStatus = {
  className: string;
  label: string;
  primaryAction: 'install' | 'open' | 'update';
};

const emptyAddonState: AddonStorageState = {
  installedAddons: {}
};

const availableAddons = getAvailableAddonManifests();

export default function AddonsOverlay({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<AddonsTab>('installed');
  const [addonState, setAddonState] = useState<AddonStorageState>(emptyAddonState);
  const [downloads, setDownloads] = useState<AddonDownloadTask[]>([]);
  const [openAddonId, setOpenAddonId] = useState<string | null>(null);
  const [busyAddonId, setBusyAddonId] = useState<string | null>(null);
  const [downloadsOpen, setDownloadsOpen] = useState(false);
  const [confirmingUninstallAddonId, setConfirmingUninstallAddonId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const openAddon = useMemo(
    () => availableAddons.find((addon) => addon.id === openAddonId),
    [openAddonId]
  );
  const installedAddons = useMemo(
    () => availableAddons.filter((addon) => addonState.installedAddons[addon.id]),
    [addonState]
  );

  useEffect(() => {
    let mounted = true;

    Promise.all([window.floatAI.getAddonState(), window.floatAI.getAddonDownloads()])
      .then(([nextAddonState, nextDownloads]) => {
        if (!mounted) {
          return;
        }

        setAddonState(nextAddonState);
        setDownloads(nextDownloads);
      })
      .catch((loadError) => {
        if (mounted) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load add-ons.');
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (openAddonId) {
        setOpenAddonId(null);
        return;
      }

      if (downloadsOpen) {
        setDownloadsOpen(false);
        return;
      }

      if (activeTab === 'marketplace') {
        setActiveTab('installed');
        setConfirmingUninstallAddonId(null);
        return;
      }

      onClose();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [activeTab, downloadsOpen, onClose, openAddonId]);

  async function handleInstall(addonId: string) {
    setBusyAddonId(addonId);
    setError('');

    try {
      const nextState = await window.floatAI.installAddon(addonId);
      setAddonState(nextState);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : 'Could not install this add-on.');
    } finally {
      setBusyAddonId(null);
    }
  }

  async function handleUninstall(addonId: string) {
    setBusyAddonId(addonId);
    setError('');

    try {
      const nextState = await window.floatAI.uninstallAddon(addonId);
      setAddonState(nextState);
      setConfirmingUninstallAddonId(null);

      if (openAddonId === addonId) {
        setOpenAddonId(null);
      }
    } catch (uninstallError) {
      setError(uninstallError instanceof Error ? uninstallError.message : 'Could not uninstall this add-on.');
    } finally {
      setBusyAddonId(null);
    }
  }

  function handlePrimaryAction(addon: AddonManifest) {
    const status = getAddonStatus(addon, addonState);

    if (status.primaryAction === 'open') {
      setOpenAddonId(addon.id);
      return;
    }

    void handleInstall(addon.id);
  }

  function renderAddonPanel(addon: AddonManifest) {
    if (addon.id === 'scratchpad') {
      return <ScratchPadPanel />;
    }

    if (addon.id === 'speedtest') {
      return <SpeedTestPanel />;
    }

    return (
      <div className="addon-empty-state">
        <PackageCheck size={30} />
        <strong>Add-on unavailable</strong>
        <span>This add-on is installed but does not have a bundled panel yet.</span>
      </div>
    );
  }

  return (
    <section className="addons-overlay" aria-label="Add-ons">
      <header className="addons-header">
        <div className="addons-heading">
          {(openAddon || activeTab === 'marketplace') && (
            <button
              className="icon-button soft addons-back-button no-drag"
              type="button"
              onClick={() => {
                setOpenAddonId(null);
                setActiveTab('installed');
                setDownloadsOpen(false);
                setConfirmingUninstallAddonId(null);
              }}
              title="Back to add-ons"
              aria-label="Back to add-ons"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <div>
            <h1>{openAddon ? openAddon.title : activeTab === 'marketplace' ? 'Marketplace' : 'Add-ons'}</h1>
            <p>
              {openAddon
                ? openAddon.description
                : activeTab === 'marketplace'
                  ? 'Find official tools for Float AI.'
                  : 'Installed tools'}
            </p>
          </div>
        </div>
        <div className="addons-header-actions">
          {!openAddon && (
            <>
              <div className="addons-download-menu">
                <button
                  className={downloadsOpen ? 'icon-button soft active' : 'icon-button soft'}
                  type="button"
                  onClick={() => setDownloadsOpen((open) => !open)}
                  title="Downloads"
                  aria-label="Show add-on downloads"
                >
                  <Download size={17} />
                </button>
                {downloadsOpen && (
                  <div className="addons-download-popover">
                    <DownloadsPanel downloads={downloads} compact />
                  </div>
                )}
              </div>
              {activeTab !== 'marketplace' && (
                <button
                  className="addon-get-more-button"
                  type="button"
                  onClick={() => {
                    setActiveTab('marketplace');
                    setDownloadsOpen(false);
                    setConfirmingUninstallAddonId(null);
                  }}
                >
                  Get more add-ons
                </button>
              )}
            </>
          )}
          <button className="icon-button close-button" type="button" onClick={onClose} title="Close add-ons">
            <X size={18} />
          </button>
        </div>
      </header>

      {!openAddon && (
        <>
          {error && <div className="addon-error">{error}</div>}

          <div className="addons-body">
            {activeTab === 'marketplace' && (
              <AddonGrid
                addons={availableAddons}
                addonState={addonState}
                busyAddonId={busyAddonId}
                confirmingUninstallAddonId={confirmingUninstallAddonId}
                onCancelUninstall={() => setConfirmingUninstallAddonId(null)}
                onPrimaryAction={handlePrimaryAction}
                onRequestUninstall={(addonId) => setConfirmingUninstallAddonId(addonId)}
                onUninstall={handleUninstall}
              />
            )}

            {activeTab === 'installed' && (
              installedAddons.length > 0 ? (
                <InstalledAddonList
                  addons={installedAddons}
                  busyAddonId={busyAddonId}
                  confirmingUninstallAddonId={confirmingUninstallAddonId}
                  onCancelUninstall={() => setConfirmingUninstallAddonId(null)}
                  onOpen={(addonId) => {
                    setOpenAddonId(addonId);
                    setConfirmingUninstallAddonId(null);
                  }}
                  onRequestUninstall={(addonId) => setConfirmingUninstallAddonId(addonId)}
                  onUninstall={handleUninstall}
                />
              ) : (
                <div className="addon-empty-state">
                  <PackagePlus size={30} />
                  <strong>No add-ons installed</strong>
                  <span>Install ScratchPad or SpeedTest from Marketplace to pin it here.</span>
                  <button className="primary-button compact" type="button" onClick={() => setActiveTab('marketplace')}>
                    <PackagePlus size={15} />
                    Get more add-ons
                  </button>
                </div>
              )
            )}
          </div>
        </>
      )}

      {openAddon && <div className="addon-panel-host">{renderAddonPanel(openAddon)}</div>}
    </section>
  );
}

function AddonGrid({
  addons,
  addonState,
  busyAddonId,
  confirmingUninstallAddonId,
  onCancelUninstall,
  onPrimaryAction,
  onRequestUninstall,
  onUninstall
}: {
  addons: AddonManifest[];
  addonState: AddonStorageState;
  busyAddonId: string | null;
  confirmingUninstallAddonId: string | null;
  onCancelUninstall: () => void;
  onPrimaryAction: (addon: AddonManifest) => void;
  onRequestUninstall: (addonId: string) => void;
  onUninstall: (addonId: string) => void;
}) {
  return (
    <div className="addon-grid">
      {addons.map((addon) => (
        <AddonCard
          addon={addon}
          busy={busyAddonId === addon.id}
          confirmingUninstall={confirmingUninstallAddonId === addon.id}
          key={addon.id}
          state={addonState}
          onCancelUninstall={onCancelUninstall}
          onPrimaryAction={() => onPrimaryAction(addon)}
          onRequestUninstall={() => onRequestUninstall(addon.id)}
          onUninstall={() => onUninstall(addon.id)}
        />
      ))}
    </div>
  );
}

function InstalledAddonList({
  addons,
  busyAddonId,
  confirmingUninstallAddonId,
  onCancelUninstall,
  onOpen,
  onRequestUninstall,
  onUninstall
}: {
  addons: AddonManifest[];
  busyAddonId: string | null;
  confirmingUninstallAddonId: string | null;
  onCancelUninstall: () => void;
  onOpen: (addonId: string) => void;
  onRequestUninstall: (addonId: string) => void;
  onUninstall: (addonId: string) => void;
}) {
  return (
    <div className="installed-addon-list">
      {addons.map((addon) => (
        <div className="installed-addon-row" key={addon.id}>
          <button className="installed-addon-open" type="button" onClick={() => onOpen(addon.id)}>
            <AddonGlyph addon={addon} />
            <span>{addon.title}</span>
          </button>
          {confirmingUninstallAddonId === addon.id ? (
            <div className="installed-addon-confirm">
              <span>Uninstall?</span>
              <button type="button" onClick={onCancelUninstall}>
                Cancel
              </button>
              <button type="button" onClick={() => onUninstall(addon.id)} disabled={busyAddonId === addon.id}>
                {busyAddonId === addon.id ? 'Working' : 'Uninstall'}
              </button>
            </div>
          ) : (
            <button
              className="installed-addon-uninstall"
              type="button"
              onClick={() => onRequestUninstall(addon.id)}
              disabled={busyAddonId === addon.id}
            >
              Uninstall
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AddonCard({
  addon,
  busy,
  confirmingUninstall,
  onCancelUninstall,
  onPrimaryAction,
  onRequestUninstall,
  onUninstall,
  state
}: {
  addon: AddonManifest;
  busy: boolean;
  confirmingUninstall: boolean;
  onCancelUninstall: () => void;
  onPrimaryAction: () => void;
  onRequestUninstall: () => void;
  onUninstall: () => void;
  state: AddonStorageState;
}) {
  const installedAddon = state.installedAddons[addon.id];
  const status = getAddonStatus(addon, state);
  const primaryLabel =
    status.primaryAction === 'install' ? 'Install' : status.primaryAction === 'update' ? 'Update' : 'Open';

  return (
    <article className="addon-card">
      <div className="addon-card-topline">
        <AddonGlyph addon={addon} />
        <span className={`addon-status-badge ${status.className}`}>{status.label}</span>
      </div>
      <div className="addon-card-copy">
        <div className="addon-card-title-row">
          <h2>{addon.title}</h2>
          {addon.official && (
            <span className="addon-official-badge">
              <ShieldCheck size={13} />
              Official
            </span>
          )}
        </div>
        <p>{addon.description}</p>
      </div>
      <div className="addon-card-meta">
        <span>{addon.author}</span>
        <span>v{addon.version}</span>
        {addon.category && <span>{addon.category}</span>}
      </div>
      <div className="addon-permissions">
        {addon.permissions.map((permission) => (
          <span key={permission}>{formatPermission(permission)}</span>
        ))}
      </div>
      <div className="addon-card-actions">
        <button className="primary-button compact" type="button" onClick={onPrimaryAction} disabled={busy}>
          {status.primaryAction === 'open' ? <Check size={15} /> : <PackagePlus size={15} />}
          {busy ? 'Working' : primaryLabel}
        </button>
        {installedAddon && !confirmingUninstall && (
          <button className="addon-secondary-button" type="button" onClick={onRequestUninstall} disabled={busy}>
            Uninstall
          </button>
        )}
        {installedAddon && confirmingUninstall && (
          <div className="marketplace-uninstall-confirm">
            <span>Uninstall?</span>
            <button type="button" onClick={onCancelUninstall}>
              Cancel
            </button>
            <button type="button" onClick={onUninstall} disabled={busy}>
              {busy ? 'Working' : 'Yes'}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function AddonGlyph({ addon }: { addon: AddonManifest }) {
  const icon = addon.id === 'scratchpad' ? <StickyNote size={22} /> : addon.id === 'speedtest' ? <Gauge size={22} /> : <PackageCheck size={22} />;

  return <span className={`addon-glyph addon-glyph-${addon.id}`}>{icon}</span>;
}

function DownloadsPanel({ compact = false, downloads }: { compact?: boolean; downloads: AddonDownloadTask[] }) {
  if (downloads.length === 0) {
    return (
      <div className={compact ? 'addon-empty-state compact-download-empty' : 'addon-empty-state'}>
        <Download size={30} />
        <strong>No active downloads</strong>
        <span>Built-in add-ons install instantly. Future marketplace packages will appear here.</span>
      </div>
    );
  }

  return (
    <div className="addon-download-list">
      {downloads.map((download) => (
        <div className="addon-download-row" key={download.id}>
          <div>
            <strong>{download.addonTitle}</strong>
            <span>{download.status}</span>
          </div>
          <div className="addon-download-progress" aria-label={`${download.progress}%`}>
            <span style={{ width: `${Math.min(100, Math.max(0, download.progress))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function getAddonStatus(addon: AddonManifest, state: AddonStorageState): AddonStatus {
  const installedAddon = state.installedAddons[addon.id];

  if (!installedAddon) {
    return {
      className: 'not-installed',
      label: 'Not Installed',
      primaryAction: 'install'
    };
  }

  if (installedAddon.installedVersion !== addon.version) {
    return {
      className: 'update-available',
      label: 'Update Available',
      primaryAction: 'update'
    };
  }

  return {
    className: 'installed',
    label: 'Installed',
    primaryAction: 'open'
  };
}

function formatPermission(permission: string): string {
  const labels: Record<string, string> = {
    clipboard: 'Clipboard',
    network: 'Network',
    notifications: 'Notifications',
    providerWebRequest: 'Provider web request',
    storage: 'Storage'
  };

  return labels[permission] ?? permission;
}
