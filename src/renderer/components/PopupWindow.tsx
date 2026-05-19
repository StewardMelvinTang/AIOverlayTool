import {
  Check,
  ChevronLeft,
  ChevronRight,
  Edit3,
  GripVertical,
  HelpCircle,
  ImagePlus,
  Keyboard,
  Moon,
  Plus,
  RefreshCw,
  Save,
  Settings,
  Sun,
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

type SettingsTab = 'window' | 'providers' | 'shortcut' | 'performance';

type ProviderDraft = {
  name: string;
  url: string;
  icon: string;
};

type ProviderTooltipState = {
  providerId: string;
  left: number;
  visible: boolean;
};

type ProviderDragState = {
  activeId: string;
  activeIndex: number;
  targetIndex: number;
  offsetY: number;
  rowPitch: number;
};

type ProviderDragSession = ProviderDragState & {
  pointerId: number;
  startY: number;
  providers: Provider[];
};

type ProviderDragListeners = {
  move: (event: PointerEvent) => void;
  end: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
};

type WebviewElement = HTMLElement & {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getURL: () => string;
  goBack: () => void;
  goForward: () => void;
  reload: () => void;
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
  const [hotkeyListening, setHotkeyListening] = useState(false);
  const [hotkeyError, setHotkeyError] = useState('');
  const [providerDraft, setProviderDraft] = useState<ProviderDraft>(emptyProviderDraft);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [providerError, setProviderError] = useState('');
  const [providerIconUrls, setProviderIconUrls] = useState<Record<string, string>>({});
  const [draftIconUrl, setDraftIconUrl] = useState('');
  const [autoIconLoading, setAutoIconLoading] = useState(false);
  const [isResizingMode, setIsResizingMode] = useState(false);
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);
  const [providerTooltip, setProviderTooltip] = useState<ProviderTooltipState | null>(null);
  const [providerDrag, setProviderDrag] = useState<ProviderDragState | null>(null);
  const webviewRefs = useRef<Record<string, WebviewElement | null>>({});
  const webviewCleanupRefs = useRef<Record<string, (() => void) | undefined>>({});
  const providerLastUrlsRef = useRef<Record<string, string>>({});
  const unloadTimersRef = useRef<Record<string, ReturnType<typeof setTimeout> | undefined>>({});
  const providerTooltipTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const providerDragSessionRef = useRef<ProviderDragSession | null>(null);
  const providerDragListenersRef = useRef<ProviderDragListeners | null>(null);
  const providerDragFrameRef = useRef<number | undefined>(undefined);
  const loadedProviderIdsRef = useRef<Set<string>>(new Set());
  const selectedProviderIdRef = useRef('');
  const webviewInitialUrlsRef = useRef<Record<string, string>>({});
  const [loadedProviderIds, setLoadedProviderIds] = useState<Set<string>>(() => new Set());
  const providerStripRef = useRef<HTMLDivElement>(null);
  const [scrollState, setScrollState] = useState({ left: false, right: false });
  const [isVisible, setIsVisible] = useState(true);
  const isMac = window.floatAI.platform === 'darwin';

  const checkStripScroll = useCallback(() => {
    if (!providerStripRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = providerStripRef.current;
    setScrollState({
      left: scrollLeft > 0,
      right: Math.ceil(scrollLeft + clientWidth) < scrollWidth - 1
    });
  }, []);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    const container = e.currentTarget;

    // If there is any active horizontal scroll wheel or trackpad delta,
    // let the browser handle it completely natively and smoothly.
    if (Math.abs(e.deltaX) > 0) {
      return;
    }

    // Redirect vertical scrollwheel actions to smooth horizontal scrolling.
    if (e.deltaY !== 0) {
      e.preventDefault();
      container.scrollTo({
        left: container.scrollLeft + e.deltaY,
        behavior: 'smooth'
      });
    }
  };

  function updateLoadedProviders(updater: (current: Set<string>) => Set<string>) {
    setLoadedProviderIds((current) => {
      const next = updater(new Set(current));
      loadedProviderIdsRef.current = next;
      return next;
    });
  }

  function clearUnloadTimer(providerId: string) {
    const timer = unloadTimersRef.current[providerId];

    if (timer) {
      clearTimeout(timer);
      unloadTimersRef.current[providerId] = undefined;
    }
  }

  function rememberProviderUrl(providerId: string) {
    const webview = webviewRefs.current[providerId];

    if (!webview || typeof webview.getURL !== 'function') {
      return;
    }

    try {
      const url = webview.getURL();

      if (isHttpUrl(url)) {
        providerLastUrlsRef.current[providerId] = url;
      }
    } catch {
      // The webview can be torn down while memory saver is unloading it.
    }
  }

  function unloadProvider(providerId: string) {
    if (selectedProviderIdRef.current === providerId) {
      return;
    }

    rememberProviderUrl(providerId);
    clearUnloadTimer(providerId);
    setLoadingByProvider((current) => ({
      ...current,
      [providerId]: false
    }));
    updateLoadedProviders((current) => {
      current.delete(providerId);
      return current;
    });
    delete webviewInitialUrlsRef.current[providerId];
  }

  function scheduleProviderUnload(providerId: string, unloadMinutes: number) {
    clearUnloadTimer(providerId);

    if (selectedProviderIdRef.current === providerId) {
      return;
    }

    unloadTimersRef.current[providerId] = setTimeout(() => {
      unloadProvider(providerId);
    }, unloadMinutes * 60 * 1000);
  }

  function getProviderStartUrl(provider: Provider) {
    return providerLastUrlsRef.current[provider.id] ?? provider.url;
  }

  function getWebviewMountUrl(provider: Provider) {
    if (!webviewInitialUrlsRef.current[provider.id]) {
      webviewInitialUrlsRef.current[provider.id] = getProviderStartUrl(provider);
    }
    return webviewInitialUrlsRef.current[provider.id];
  }

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
      setHotkeyError('');
      void markProviderVisited(nextSettings.defaultProviderId, nextSettings);
    });

    const removeSettingsListener = window.floatAI.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
      setHotkeyDraft((current) => current || nextSettings.globalHotkey);
      setHotkeyError('');
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
      for (const cleanup of Object.values(webviewCleanupRefs.current)) {
        cleanup?.();
      }
      webviewCleanupRefs.current = {};
      for (const providerId of Object.keys(unloadTimersRef.current)) {
        clearUnloadTimer(providerId);
      }
      if (providerTooltipTimerRef.current) {
        clearTimeout(providerTooltipTimerRef.current);
      }
      removeProviderDragListeners();
      cancelProviderDragFrame();
      providerDragSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!hotkeyListening) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setHotkeyListening(false);
        setHotkeyError('');
        return;
      }

      const captured = acceleratorFromKeyboardEvent(event, isMac);

      if (!captured.accelerator) {
        setHotkeyError(captured.error ?? 'Press a complete shortcut.');
        return;
      }

      setHotkeyDraft(captured.accelerator);
      setHotkeyError('');
      setHotkeyListening(false);
    };

    window.addEventListener('keydown', handleKeyDown, true);

    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [hotkeyListening, isMac]);

  useEffect(() => {
    if (!hotkeyListening) {
      window.floatAI.setShortcutCaptureActive(false).catch(() => undefined);
      return undefined;
    }

    return () => {
      window.floatAI.setShortcutCaptureActive(false).catch(() => undefined);
    };
  }, [hotkeyListening]);

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

  const providerIdsSignature = settings?.providers.map((provider) => provider.id).join('|') ?? '';
  const memorySaverEnabled = settings?.performance.memorySaver ?? true;
  const memorySaverUnloadMinutes = settings?.performance.memorySaverUnloadMinutes ?? 2;

  useEffect(() => {
    selectedProviderIdRef.current = selectedProviderId;
  }, [selectedProviderId]);

  useEffect(() => {
    if (!settings || !selectedProvider) {
      return;
    }

    const providerIds = new Set(settings.providers.map((provider) => provider.id));

    for (const providerId of Object.keys(unloadTimersRef.current)) {
      if (!providerIds.has(providerId)) {
        clearUnloadTimer(providerId);
      }
    }

    for (const providerId of Object.keys(providerLastUrlsRef.current)) {
      if (!providerIds.has(providerId)) {
        delete providerLastUrlsRef.current[providerId];
      }
    }

    for (const providerId of Object.keys(webviewInitialUrlsRef.current)) {
      if (!providerIds.has(providerId)) {
        delete webviewInitialUrlsRef.current[providerId];
      }
    }

    if (!memorySaverEnabled) {
      for (const providerId of Object.keys(unloadTimersRef.current)) {
        clearUnloadTimer(providerId);
      }

      updateLoadedProviders(() => providerIds);
      return;
    }

    clearUnloadTimer(selectedProvider.id);
    updateLoadedProviders((current) => {
      current.add(selectedProvider.id);
      for (const providerId of Array.from(current)) {
        if (!providerIds.has(providerId)) {
          current.delete(providerId);
        }
      }
      return current;
    });

    for (const providerId of Array.from(loadedProviderIdsRef.current)) {
      if (providerId !== selectedProvider.id && providerIds.has(providerId)) {
        scheduleProviderUnload(providerId, memorySaverUnloadMinutes);
      }
    }
  }, [memorySaverEnabled, memorySaverUnloadMinutes, providerIdsSignature, selectedProvider?.id, settings]);

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

  async function markProviderVisited(providerId: string, sourceSettings: FloatAISettings | null = settings) {
    if (!sourceSettings || !sourceSettings.providers.some((provider) => provider.id === providerId)) {
      return;
    }

    const visitedAt = new Date().toISOString();
    const providers = sourceSettings.providers.map((provider) =>
      provider.id === providerId
        ? {
            ...provider,
            lastVisitedAt: visitedAt
          }
        : provider
    );

    setSettings((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider) =>
              provider.id === providerId
                ? {
                    ...provider,
                    lastVisitedAt: visitedAt
                  }
                : provider
            )
          }
        : current
    );

    try {
      const nextSettings = await window.floatAI.updateSettings({ providers });
      setSettings(nextSettings);
    } catch {
      // Keep the optimistic timestamp locally if the app is closing during the update.
    }
  }

  async function saveHotkeyDraft() {
    if (!settings) {
      return;
    }

    const normalizedHotkey = normalizeAcceleratorText(hotkeyDraft, isMac) || settings.globalHotkey;
    const validationError = validateAcceleratorText(normalizedHotkey);

    if (validationError) {
      setHotkeyError(validationError);
      return;
    }

    try {
      const nextSettings = await persist({ globalHotkey: normalizedHotkey });
      setHotkeyDraft(nextSettings.globalHotkey);
      setHotkeyListening(false);
      setHotkeyError('');
    } catch (error) {
      setHotkeyError(error instanceof Error ? error.message : 'Could not register this shortcut.');
    }
  }

  async function startHotkeyListening() {
    setHotkeyError('');

    try {
      await window.floatAI.setShortcutCaptureActive(true);
      setHotkeyListening(true);
    } catch {
      setHotkeyListening(false);
      setHotkeyError('Could not pause the current shortcut. Please try listening again.');
    }
  }

  function patchPopup(patch: DeepPartial<FloatAISettings>['popup']) {
    return persist({
      popup: patch
    });
  }

  async function handleProviderChange(providerId: string) {
    if (selectedProviderId) {
      rememberProviderUrl(selectedProviderId);
    }

    setSelectedProviderId(providerId);
    setSettingsOpen(false);
    await window.floatAI.switchProvider(providerId);
    void markProviderVisited(providerId);
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

  function refreshActiveProvider() {
    const webview = webviewRefs.current[selectedProviderId];

    if (!webview || typeof webview.reload !== 'function') {
      return;
    }

    rememberProviderUrl(selectedProviderId);
    webview.reload();
    void markProviderVisited(selectedProviderId);
  }

  function showProviderTooltip(providerId: string, target: HTMLElement) {
    if (!settings?.popup.showProviderTooltip) {
      return;
    }

    if (providerTooltipTimerRef.current) {
      clearTimeout(providerTooltipTimerRef.current);
      providerTooltipTimerRef.current = undefined;
    }

    const toolbar = target.closest('.popup-toolbar') as HTMLElement | null;
    const targetRect = target.getBoundingClientRect();
    const toolbarRect = toolbar?.getBoundingClientRect();
    const toolbarLeft = toolbarRect?.left ?? 0;
    const toolbarWidth = toolbarRect?.width ?? window.innerWidth;
    const tooltipHalfWidth = 132;
    const rawLeft = targetRect.left - toolbarLeft + targetRect.width / 2;
    const left = Math.min(
      Math.max(rawLeft, tooltipHalfWidth),
      Math.max(tooltipHalfWidth, toolbarWidth - tooltipHalfWidth)
    );

    setProviderTooltip({
      providerId,
      left,
      visible: true
    });
  }

  function hideProviderTooltip() {
    setProviderTooltip((current) => (current ? { ...current, visible: false } : current));

    if (providerTooltipTimerRef.current) {
      clearTimeout(providerTooltipTimerRef.current);
    }

    providerTooltipTimerRef.current = setTimeout(() => {
      setProviderTooltip(null);
      providerTooltipTimerRef.current = undefined;
    }, 180);
  }

  function startAddProvider() {
    setEditingProviderId(null);
    setProviderDraft(emptyProviderDraft);
    setDraftIconUrl('');
    setProviderError('');
    setAutoIconLoading(false);
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
    setAutoIconLoading(false);
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

  async function getIconForDraftAutomatically() {
    const providerUrl = providerDraft.url.trim();

    if (!providerUrl) {
      setProviderError('Provider URL is required before getting an icon.');
      return;
    }

    setAutoIconLoading(true);
    setProviderError('');

    try {
      const pickedIcon = await window.floatAI.getProviderIconFromUrl(providerUrl);
      setProviderDraft((currentDraft) => ({
        ...currentDraft,
        icon: pickedIcon.icon
      }));
      setDraftIconUrl(pickedIcon.url);
    } catch (error) {
      setProviderError(error instanceof Error ? error.message : 'Could not get an icon from that website.');
    } finally {
      setAutoIconLoading(false);
    }
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
    setAutoIconLoading(false);
    setProviderFormOpen(false);
  }

  function removeProviderDragListeners() {
    const listeners = providerDragListenersRef.current;

    if (!listeners) {
      return;
    }

    window.removeEventListener('pointermove', listeners.move);
    window.removeEventListener('pointerup', listeners.end);
    window.removeEventListener('pointercancel', listeners.cancel);
    providerDragListenersRef.current = null;
  }

  function cancelProviderDragFrame() {
    if (providerDragFrameRef.current === undefined) {
      return;
    }

    window.cancelAnimationFrame(providerDragFrameRef.current);
    providerDragFrameRef.current = undefined;
  }

  function queueProviderDragRender() {
    if (providerDragFrameRef.current !== undefined) {
      return;
    }

    providerDragFrameRef.current = window.requestAnimationFrame(() => {
      providerDragFrameRef.current = undefined;
      const session = providerDragSessionRef.current;

      if (!session) {
        return;
      }

      setProviderDrag({
        activeId: session.activeId,
        activeIndex: session.activeIndex,
        targetIndex: session.targetIndex,
        offsetY: session.offsetY,
        rowPitch: session.rowPitch
      });
    });
  }

  function startProviderReorder(providerId: string, event: React.PointerEvent<HTMLButtonElement>) {
    if (!settings || settings.providers.length <= 1) {
      return;
    }

    const activeIndex = settings.providers.findIndex((provider) => provider.id === providerId);

    if (activeIndex === -1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    removeProviderDragListeners();
    cancelProviderDragFrame();

    const activeRow = event.currentTarget.closest<HTMLElement>('.compact-provider-row');
    const list = event.currentTarget.closest<HTMLElement>('.compact-provider-list');
    const rows = list ? Array.from(list.querySelectorAll<HTMLElement>('.compact-provider-row')) : [];
    const activeRect = activeRow?.getBoundingClientRect();
    const previousRect = rows[activeIndex - 1]?.getBoundingClientRect();
    const nextRect = rows[activeIndex + 1]?.getBoundingClientRect();
    const measuredPitch =
      activeRect && nextRect
        ? nextRect.top - activeRect.top
        : activeRect && previousRect
          ? activeRect.top - previousRect.top
          : undefined;
    const fallbackPitch = (activeRect?.height ?? 68) + 10;
    const rowPitch = Math.max(activeRect?.height ?? 68, measuredPitch ?? fallbackPitch);

    const session: ProviderDragSession = {
      activeId: providerId,
      activeIndex,
      targetIndex: activeIndex,
      offsetY: 0,
      rowPitch,
      pointerId: event.pointerId,
      startY: event.clientY,
      providers: settings.providers
    };

    providerDragSessionRef.current = session;
    setProviderDrag({
      activeId: session.activeId,
      activeIndex: session.activeIndex,
      targetIndex: session.targetIndex,
      offsetY: session.offsetY,
      rowPitch: session.rowPitch
    });

    const listeners: ProviderDragListeners = {
      move: (pointerEvent) => handleProviderDragMove(pointerEvent),
      end: (pointerEvent) => {
        void finishProviderReorder(pointerEvent);
      },
      cancel: (pointerEvent) => cancelProviderReorder(pointerEvent)
    };

    providerDragListenersRef.current = listeners;
    window.addEventListener('pointermove', listeners.move, { passive: false });
    window.addEventListener('pointerup', listeners.end);
    window.addEventListener('pointercancel', listeners.cancel);
  }

  function handleProviderDragMove(event: PointerEvent) {
    const session = providerDragSessionRef.current;

    if (!session || event.pointerId !== session.pointerId) {
      return;
    }

    event.preventDefault();

    const offsetY = event.clientY - session.startY;
    const rawTargetIndex = session.activeIndex + Math.round(offsetY / session.rowPitch);
    const targetIndex = clampIndex(rawTargetIndex, 0, session.providers.length - 1);

    session.offsetY = offsetY;
    session.targetIndex = targetIndex;
    queueProviderDragRender();
  }

  async function finishProviderReorder(event?: PointerEvent) {
    const session = providerDragSessionRef.current;

    if (!session || (event && event.pointerId !== session.pointerId)) {
      return;
    }

    removeProviderDragListeners();
    cancelProviderDragFrame();
    providerDragSessionRef.current = null;

    if (session.targetIndex === session.activeIndex) {
      setProviderDrag(null);
      return;
    }

    const nextProviders = moveProvider(session.providers, session.activeIndex, session.targetIndex);
    setSettings((current) => (current ? { ...current, providers: nextProviders } : current));
    setProviderDrag(null);

    try {
      await persist({ providers: nextProviders });
      setProviderError('');
    } catch {
      setSettings((current) => (current ? { ...current, providers: session.providers } : current));
      setProviderError('Could not save provider order.');
    }
  }

  function cancelProviderReorder(event?: PointerEvent) {
    const session = providerDragSessionRef.current;

    if (!session || (event && event.pointerId !== session.pointerId)) {
      return;
    }

    removeProviderDragListeners();
    cancelProviderDragFrame();
    providerDragSessionRef.current = null;
    setProviderDrag(null);
  }

  function getProviderRowClassName(providerId: string, index: number): string {
    const classNames = ['compact-provider-row'];

    if (providerDrag) {
      classNames.push('reordering-row');

      if (providerDrag.activeId === providerId) {
        classNames.push('dragging-provider');
      } else if (isProviderRowShifted(index, providerDrag)) {
        classNames.push('reorder-shift');
      }
    }

    return classNames.join(' ');
  }

  function getProviderRowDragStyle(providerId: string, index: number): CSSProperties | undefined {
    if (!providerDrag) {
      return undefined;
    }

    if (providerDrag.activeId === providerId) {
      return {
        transform: `translate3d(0, ${providerDrag.offsetY}px, 0) scale(1.015)`
      };
    }

    if (!isProviderRowShifted(index, providerDrag)) {
      return undefined;
    }

    const direction = providerDrag.targetIndex > providerDrag.activeIndex ? -1 : 1;

    return {
      transform: `translate3d(0, ${direction * providerDrag.rowPitch}px, 0)`
    };
  }

  function setWebviewRef(providerId: string, element: WebviewElement | null) {
    const existingWebview = webviewRefs.current[providerId];

    if (existingWebview === element) {
      return;
    }

    webviewCleanupRefs.current[providerId]?.();
    webviewCleanupRefs.current[providerId] = undefined;
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

    const handleStartLoading = () => setProviderLoading(true);
    const handleStopLoading = () => setProviderLoading(false);
    const handleNavigation = () => rememberProviderUrl(providerId);

    element.addEventListener('did-start-loading', handleStartLoading);
    element.addEventListener('did-stop-loading', handleStopLoading);
    element.addEventListener('did-fail-load', handleStopLoading);
    element.addEventListener('did-navigate', handleNavigation);
    element.addEventListener('did-navigate-in-page', handleNavigation);
    element.addEventListener('dom-ready', handleNavigation);

    webviewCleanupRefs.current[providerId] = () => {
      rememberProviderUrl(providerId);
      element.removeEventListener('did-start-loading', handleStartLoading);
      element.removeEventListener('did-stop-loading', handleStopLoading);
      element.removeEventListener('did-fail-load', handleStopLoading);
      element.removeEventListener('did-navigate', handleNavigation);
      element.removeEventListener('did-navigate-in-page', handleNavigation);
      element.removeEventListener('dom-ready', handleNavigation);
    };
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

  const suppressMacToolbarEvent = (event: React.MouseEvent<HTMLElement>) => {
    if (!isMac) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  };

  const suppressMacToolbarMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (isMac && (event.button !== 0 || event.detail > 1)) {
      suppressMacToolbarEvent(event);
    }
  };

  if (!settings || !selectedProvider) {
    return (
      <div className={`popup-shell ${isMac ? 'mac-platform' : ''}`}>
        <div
          className="popup-toolbar"
          onContextMenu={suppressMacToolbarEvent}
          onDoubleClick={suppressMacToolbarEvent}
          onMouseDown={suppressMacToolbarMouseDown}
        >
          <div className="provider-strip" />
        </div>
        <div className="loading-surface">Loading</div>
      </div>
    );
  }

  const targetOpacity = isVisible ? settings.popup.opacity : 0;

  const chromeStyle = {
    '--chrome-opacity': '1',
    '--toolbar-action-count': settings.popup.showRefreshButton ? '3' : '2',
    opacity: targetOpacity,
    transition: 'opacity 0.1s ease',
    pointerEvents: isVisible ? 'auto' : 'none'
  } as CSSProperties;
  const tooltipProvider = providerTooltip
    ? settings.providers.find((provider) => provider.id === providerTooltip.providerId)
    : undefined;
  const normalizedHotkeyDraft = normalizeAcceleratorText(hotkeyDraft, isMac);
  const hotkeyHasChanges = Boolean(normalizedHotkeyDraft) && normalizedHotkeyDraft !== settings.globalHotkey;

  return (
    <div
      className={`popup-shell ${settings.darkMode ? 'dark-theme' : 'light-theme'} ${isMac ? 'mac-platform' : ''}`}
      style={chromeStyle}
    >
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
      <header
        className="popup-toolbar"
        onContextMenu={suppressMacToolbarEvent}
        onDoubleClick={suppressMacToolbarEvent}
        onMouseDown={suppressMacToolbarMouseDown}
      >
        <div className={`provider-strip-wrapper ${scrollState.left ? 'mask-left' : ''} ${scrollState.right ? 'mask-right' : ''}`}>
          <div
            className="provider-strip"
            aria-label="Providers"
            ref={providerStripRef}
            onScroll={checkStripScroll}
            onWheel={handleWheel}
          >
            {settings.providers.map((provider) => {
              const isActiveProvider = provider.id === selectedProvider.id;
              const isCompactProviderBar = settings.compactProviderBar ?? false;
              const showProviderLabel = !isCompactProviderBar || isActiveProvider;

              return (
                <button
                  key={provider.id}
                  type="button"
                  className={[
                    'provider-pill',
                    isActiveProvider ? 'active' : '',
                    isCompactProviderBar ? 'compact-provider-pill' : '',
                    showProviderLabel ? 'has-visible-label' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => handleProviderChange(provider.id)}
                  onMouseEnter={(event) => showProviderTooltip(provider.id, event.currentTarget)}
                  onMouseLeave={hideProviderTooltip}
                  onFocus={(event) => showProviderTooltip(provider.id, event.currentTarget)}
                  onBlur={hideProviderTooltip}
                  aria-label={`${provider.name}, ${formatProviderWebPage(provider.url)}`}
                >
                  <ProviderLogo provider={provider} iconUrl={providerIconUrls[provider.id]} />
                  <span
                    className={showProviderLabel ? 'provider-pill-label visible' : 'provider-pill-label'}
                    aria-hidden={!showProviderLabel}
                  >
                    {provider.name}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {settings.popup.showProviderTooltip && tooltipProvider && providerTooltip && (
          <div
            className={providerTooltip.visible ? 'provider-hover-card visible' : 'provider-hover-card'}
            style={{ left: providerTooltip.left }}
            aria-hidden="true"
          >
            <strong>{tooltipProvider.name}</strong>
            <span className="provider-hover-url">{formatProviderWebPage(tooltipProvider.url)}</span>
            {settings.popup.showProviderTooltipLastVisited && (
              <span className="provider-hover-visited">{formatLastVisited(tooltipProvider.lastVisitedAt)}</span>
            )}
          </div>
        )}
        {settings.popup.showRefreshButton && (
          <button
            className="icon-button no-drag refresh-button"
            type="button"
            onClick={refreshActiveProvider}
            title="Refresh page"
            aria-label="Refresh current provider page"
          >
            <RefreshCw size={17} />
          </button>
        )}
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
          {settings.providers.map((provider) => {
            const shouldKeepLoaded =
              !memorySaverEnabled || provider.id === selectedProvider.id || loadedProviderIds.has(provider.id);

            if (!shouldKeepLoaded) {
              return null;
            }

            return (
              <webview
                key={provider.id}
                ref={(element) => setWebviewRef(provider.id, element as WebviewElement | null)}
                className={provider.id === selectedProvider.id ? 'provider-webview active' : 'provider-webview'}
                src={getWebviewMountUrl(provider)}
                partition="persist:floatai-sites"
                allowpopups
              />
            );
          })}
        </div>

        <aside className={`settings-drawer no-drag ${settingsOpen ? 'open' : ''}`}>
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
              <button
                type="button"
                className={settingsTab === 'performance' ? 'drawer-tab active' : 'drawer-tab'}
                onClick={() => setSettingsTab('performance')}
              >
                Performance
              </button>
            </div>

            {settingsTab === 'window' && (
              <div className="drawer-section">
                <section className="settings-group">
                  <h2 className="settings-group-title">Appearance</h2>
                  <div className="settings-group-body">
                    <div className="compact-field window-size-field">
                      <span>Window size</span>
                      <div className="window-size-control">
                        <span className="window-size-value">
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
                    <div className="theme-segmented-row">
                      <span>Theme</span>
                      <div className="segmented-control">
                        <div className={`segmented-slider ${settings.darkMode ? 'dark-active' : 'light-active'}`} />
                        <button
                          type="button"
                          className={`segmented-btn ${!settings.darkMode ? 'active' : ''}`}
                          onClick={() => persist({ darkMode: false })}
                        >
                          <Sun size={14} className="segmented-icon" />
                          <span>Light</span>
                        </button>
                        <button
                          type="button"
                          className={`segmented-btn ${settings.darkMode ? 'active' : ''}`}
                          onClick={() => persist({ darkMode: true })}
                        >
                          <Moon size={14} className="segmented-icon" />
                          <span>Dark</span>
                        </button>
                      </div>
                    </div>
                    <CompactToggleRow
                      label="Show tooltip"
                      checked={settings.popup.showProviderTooltip}
                      onChange={(showProviderTooltip) => patchPopup({ showProviderTooltip })}
                    />
                    {settings.popup.showProviderTooltip && (
                      <div className="conditional-setting-row">
                        <CompactToggleRow
                          label="Show last visited"
                          checked={settings.popup.showProviderTooltipLastVisited}
                          onChange={(showProviderTooltipLastVisited) =>
                            patchPopup({ showProviderTooltipLastVisited })
                          }
                        />
                      </div>
                    )}
                  </div>
                </section>
                <section className="settings-group">
                  <h2 className="settings-group-title">System</h2>
                  <div className="settings-group-body">
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
                      label="Hide on defocus"
                      checked={settings.popup.hideOnBlur}
                      onChange={(hideOnBlur) => patchPopup({ hideOnBlur })}
                      tooltip="Automatically hides FloatAI when you click outside the window."
                    />
                    <CompactToggleRow
                      label="Show refresh button"
                      checked={settings.popup.showRefreshButton}
                      onChange={(showRefreshButton) => patchPopup({ showRefreshButton })}
                    />
                    <CompactToggleRow
                      label={isMac ? 'Menu bar icon' : 'Tray icon'}
                      checked={settings.showTrayIcon}
                      onChange={(showTrayIcon) => persist({ showTrayIcon })}
                    />
                    <CompactToggleRow
                      label={isMac ? 'Launch at login' : 'Launch at startup'}
                      checked={settings.launchAtStartup}
                      onChange={(launchAtStartup) => persist({ launchAtStartup })}
                    />
                    <CompactToggleRow
                      label="Privacy Capture Protection"
                      checked={settings.privacy?.captureProtection ?? false}
                      onChange={(captureProtection) => persist({ privacy: { captureProtection } })}
                      tooltip="Hides FloatAI from screenshots and screen sharing where supported. Support varies by operating system and capture app."
                    />
                  </div>
                </section>
              </div>
            )}

            {settingsTab === 'providers' && (
              <div className="drawer-section provider-drawer">
                <div className={providerDrag ? 'compact-provider-list reordering' : 'compact-provider-list'}>
                  {settings.providers.map((provider, index) => (
                    <div
                      className={getProviderRowClassName(provider.id, index)}
                      data-provider-row-id={provider.id}
                      key={provider.id}
                      style={getProviderRowDragStyle(provider.id, index)}
                    >
                      <button
                        type="button"
                        className={
                          providerDrag?.activeId === provider.id
                            ? 'provider-reorder-handle dragging'
                            : 'provider-reorder-handle'
                        }
                        onPointerDown={(event) => startProviderReorder(provider.id, event)}
                        disabled={settings.providers.length <= 1}
                        title="Drag to reorder"
                        aria-label={`Drag ${provider.name} to reorder`}
                      >
                        <GripVertical size={16} />
                      </button>
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
                {providerError && !providerFormOpen && (
                  <div className="provider-inline-error" role="status">
                    {providerError}
                  </div>
                )}
                <div style={{ marginTop: 'auto' }}>
                  <CompactToggleRow
                    label="Compact bar"
                    checked={settings.compactProviderBar ?? false}
                    onChange={(compactProviderBar) => persist({ compactProviderBar })}
                    tooltip="Hide provider names in the top bar to save space. Active provider name is always shown."
                  />
                  <button className="add-provider-button" style={{ marginTop: '10px' }} type="button" onClick={startAddProvider}>
                    <Plus size={16} />
                    Add provider
                  </button>
                </div>
              </div>
            )}

            {settingsTab === 'shortcut' && (
              <div className="drawer-section">
                <div className={hotkeyListening ? 'compact-field shortcut-field listening' : 'compact-field shortcut-field'}>
                  <span>Global hotkey</span>
                  <div className="shortcut-control">
                    <input
                      className="input"
                      value={hotkeyListening ? 'Listening...' : hotkeyDraft}
                      onChange={(event) => {
                        setHotkeyDraft(event.target.value);
                        setHotkeyError('');
                      }}
                      readOnly={hotkeyListening}
                      placeholder={isMac ? 'Option+Space' : 'F20'}
                    />
                    <div className="shortcut-actions">
                      <button
                        className={hotkeyListening ? 'shortcut-listen-button active' : 'shortcut-listen-button'}
                        type="button"
                        onClick={() => {
                          setHotkeyError('');
                          if (hotkeyListening) {
                            setHotkeyListening(false);
                          } else {
                            void startHotkeyListening();
                          }
                        }}
                      >
                        {hotkeyListening ? <X size={16} /> : <Keyboard size={16} />}
                        {hotkeyListening ? 'Cancel' : 'Listen'}
                      </button>
                      <button
                        className="primary-button compact"
                        type="button"
                        onClick={saveHotkeyDraft}
                        disabled={hotkeyListening || !hotkeyHasChanges}
                      >
                        <Save size={16} />
                        Apply
                      </button>
                    </div>
                  </div>
                </div>
                {hotkeyError && <div className="shortcut-error">{hotkeyError}</div>}
                <CompactToggleRow
                  label={isMac ? 'Cmd +/- to zoom' : 'Ctrl +/- to zoom'}
                  checked={settings.enableZoomShortcuts}
                  onChange={(enableZoomShortcuts) => persist({ enableZoomShortcuts })}
                />
                <CompactToggleRow
                  label={isMac ? 'Option 1-9 providers' : 'Alt 1-9 providers'}
                  checked={settings.enableProviderShortcuts}
                  onChange={(enableProviderShortcuts) => persist({ enableProviderShortcuts })}
                  tooltip="Switch to the first nine providers while Float AI has keyboard focus. Provider 10 and later are ignored."
                  tooltipPlacement="bottom"
                />
              </div>
            )}

            {settingsTab === 'performance' && (
              <div className="drawer-section">
                <CompactToggleRow
                  label="Memory saver"
                  checked={settings.performance.memorySaver}
                  onChange={(memorySaver) => persist({ performance: { memorySaver } })}
                  tooltip="Unloads inactive AI pages after a short delay while keeping cookies and restoring the last visited URL."
                  tooltipPlacement="bottom"
                />
                <CompactNumberRow
                  label="Unload after (min)"
                  value={settings.performance.memorySaverUnloadMinutes}
                  min={1}
                  max={60}
                  onChange={(memorySaverUnloadMinutes) =>
                    persist({ performance: { memorySaverUnloadMinutes } })
                  }
                />
                {isMac && (
                  <CompactToggleRow
                    label="Hardware acceleration"
                    checked={settings.performance.hardwareAcceleration}
                    onChange={(hardwareAcceleration) => persist({ performance: { hardwareAcceleration } })}
                    tooltip="Uses the Mac GPU for smoother webview scrolling. Restart FloatAI after changing this."
                  />
                )}
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
                    <button
                      className="auto-icon-button"
                      type="button"
                      onClick={getIconForDraftAutomatically}
                      disabled={autoIconLoading}
                    >
                      <RefreshCw size={16} className={autoIconLoading ? 'spinning-icon' : ''} />
                      {autoIconLoading ? 'Getting Icon' : 'Automatically Get Icon'}
                    </button>
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
      </main>
    </div>
  );
}

type AcceleratorCaptureResult = {
  accelerator?: string;
  error?: string;
};

const modifierKeys = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'OS', 'Shift']);
const manualModifierAliases = new Map([
  ['cmd', 'Command'],
  ['command', 'Command'],
  ['ctrl', 'Control'],
  ['control', 'Control'],
  ['option', 'Option'],
  ['opt', 'Option'],
  ['alt', 'Alt'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['win', 'Super'],
  ['windows', 'Super'],
  ['meta', 'Super'],
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['ctrlorcmd', 'CommandOrControl']
]);

function acceleratorFromKeyboardEvent(event: KeyboardEvent, isMac: boolean): AcceleratorCaptureResult {
  if (modifierKeys.has(event.key)) {
    return {
      error: 'Press one more key.'
    };
  }

  const key = acceleratorKeyFromEvent(event);

  if (!key) {
    return {
      error: 'This key cannot be used as a shortcut.'
    };
  }

  const modifiers = acceleratorModifiersFromEvent(event, isMac);
  const canUseWithoutModifier = isStandaloneAcceleratorKey(key);

  if (modifiers.length === 0 && !canUseWithoutModifier) {
    return {
      error: 'Use at least one modifier key.'
    };
  }

  return {
    accelerator: [...modifiers, key].join('+')
  };
}

function acceleratorModifiersFromEvent(event: KeyboardEvent, isMac: boolean): string[] {
  const modifiers: string[] = [];

  if (isMac) {
    if (event.metaKey) modifiers.push('Command');
    if (event.ctrlKey) modifiers.push('Control');
    if (event.altKey) modifiers.push('Option');
    if (event.shiftKey) modifiers.push('Shift');
    return modifiers;
  }

  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');

  return modifiers;
}

function acceleratorKeyFromEvent(event: KeyboardEvent): string | null {
  const code = event.code;

  if (/^Key[A-Z]$/.test(code)) {
    return code.slice('Key'.length);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice('Digit'.length);
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return `num${code.slice('Numpad'.length)}`;
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
    return event.key.toUpperCase();
  }

  const keyByCode: Record<string, string> = {
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Equal: event.shiftKey ? 'Plus' : '=',
    Home: 'Home',
    Insert: 'Insert',
    Minus: 'Minus',
    NumpadAdd: 'Plus',
    NumpadDecimal: 'Decimal',
    NumpadDivide: 'Divide',
    NumpadMultiply: 'Multiply',
    NumpadSubtract: 'Subtract',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Space: 'Space',
    Tab: 'Tab'
  };

  if (keyByCode[code]) {
    return keyByCode[code];
  }

  const mediaKeyByKey: Record<string, string> = {
    AudioVolumeDown: 'VolumeDown',
    AudioVolumeMute: 'VolumeMute',
    AudioVolumeUp: 'VolumeUp',
    MediaNextTrack: 'MediaNextTrack',
    MediaPlayPause: 'MediaPlayPause',
    MediaPreviousTrack: 'MediaPreviousTrack',
    MediaStop: 'MediaStop'
  };

  return mediaKeyByKey[event.key] ?? null;
}

function isStandaloneAcceleratorKey(key: string): boolean {
  return /^F([1-9]|1[0-9]|2[0-4])$/.test(key) || key.startsWith('Media') || key.startsWith('Volume');
}

function normalizeAcceleratorText(value: string, isMac: boolean): string {
  const parts = value
    .trim()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  return parts
    .map((part) => {
      const normalizedPart = part.replace(/\s+/g, '');
      const alias = manualModifierAliases.get(normalizedPart.toLowerCase());

      if (alias === 'Alt' && isMac) {
        return 'Option';
      }

      if (alias) {
        return alias;
      }

      if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(normalizedPart)) {
        return normalizedPart.toUpperCase();
      }

      if (/^[a-z]$/i.test(normalizedPart)) {
        return normalizedPart.toUpperCase();
      }

      return normalizedPart;
    })
    .join('+');
}

function validateAcceleratorText(value: string): string {
  const parts = value.split('+').map((part) => part.trim()).filter(Boolean);

  if (parts.length === 0) {
    return 'Choose a shortcut first.';
  }

  const key = parts[parts.length - 1];
  const modifiers = new Set(['Command', 'CommandOrControl', 'Control', 'Option', 'Alt', 'AltGr', 'Shift', 'Super']);

  if (modifiers.has(key)) {
    return 'Press one more key.';
  }

  if (parts.length === 1 && !isStandaloneAcceleratorKey(key)) {
    return 'Use at least one modifier key.';
  }

  return '';
}

function formatProviderWebPage(url: string): string {
  try {
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname === '/' ? '' : parsedUrl.pathname.replace(/\/$/, '');
    return `${parsedUrl.hostname}${path}`;
  } catch {
    return url;
  }
}

function formatLastVisited(lastVisitedAt?: string): string {
  if (!lastVisitedAt) {
    return 'never visited';
  }

  const visitedTime = new Date(lastVisitedAt).getTime();

  if (!Number.isFinite(visitedTime)) {
    return 'never visited';
  }

  const elapsedMs = Math.max(0, Date.now() - visitedTime);
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (elapsedMs < minuteMs) {
    return 'last visited just now';
  }

  if (elapsedMs < hourMs) {
    return `last visited ${Math.floor(elapsedMs / minuteMs)}m ago`;
  }

  if (elapsedMs < dayMs) {
    return `last visited ${Math.floor(elapsedMs / hourMs)}h ago`;
  }

  const days = Math.floor(elapsedMs / dayMs);

  if (days >= 30) {
    return 'last visited 30days+';
  }

  return `last visited ${days} ${days === 1 ? 'day' : 'days'} ago`;
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
  onChange,
  tooltip,
  tooltipPlacement = 'top'
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  tooltip?: string;
  tooltipPlacement?: 'top' | 'bottom';
}) {
  return (
    <div className="compact-toggle-row">
      <span className="compact-toggle-label-wrapper">
        <span>{label}</span>
        {tooltip && (
          <span className={`tooltip-container tooltip-${tooltipPlacement}`}>
            <HelpCircle size={14} className="help-icon" />
            <span className="tooltip-text">{tooltip}</span>
          </span>
        )}
      </span>
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

function clampIndex(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function moveProvider(providers: Provider[], fromIndex: number, toIndex: number): Provider[] {
  if (fromIndex === toIndex) {
    return providers;
  }

  const nextProviders = [...providers];
  const [provider] = nextProviders.splice(fromIndex, 1);
  nextProviders.splice(toIndex, 0, provider);
  return nextProviders;
}

function isProviderRowShifted(index: number, drag: ProviderDragState): boolean {
  if (drag.targetIndex > drag.activeIndex) {
    return index > drag.activeIndex && index <= drag.targetIndex;
  }

  if (drag.targetIndex < drag.activeIndex) {
    return index >= drag.targetIndex && index < drag.activeIndex;
  }

  return false;
}
