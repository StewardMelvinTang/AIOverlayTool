import { Activity, AlertCircle, Clock, Play, Square, Wifi } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type SpeedSummary = {
  downloadMbps?: number;
  uploadMbps?: number;
  latencyMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
  testedAt: string;
};

const downloadApiUrl = 'https://speed.cloudflare.com/__down';
const uploadApiUrl = 'https://speed.cloudflare.com/__up';
const latencySampleCount = 4;
const downloadSizes = [100_000, 1_000_000, 5_000_000, 10_000_000];
const uploadSizes = [100_000, 1_000_000, 5_000_000];

export default function SpeedTestPanel() {
  const abortControllerRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<SpeedSummary | null>(null);
  const [history, setHistory] = useState<SpeedSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  async function startTest() {
    if (running) {
      return;
    }

    const runId = runIdRef.current + 1;
    runIdRef.current = runId;
    abortControllerRef.current?.abort();

    const controller = new AbortController();
    abortControllerRef.current = controller;

    setError('');
    setProgress(3);
    setRunning(true);
    setStatus('Starting test');
    setSummary(null);

    const setActiveProgress = (nextProgress: number, nextStatus: string) => {
      if (runIdRef.current !== runId) {
        return;
      }

      setProgress(Math.min(99, Math.max(0, Math.round(nextProgress))));
      setStatus(nextStatus);
    };

    const setActiveSummary = (patch: Partial<SpeedSummary>) => {
      if (runIdRef.current !== runId) {
        return;
      }

      setSummary((current) => ({
        testedAt: current?.testedAt ?? new Date().toISOString(),
        ...current,
        ...patch
      }));
    };

    try {
      setActiveProgress(6, 'Checking latency');
      const latencyPoints = await measureLatency(controller.signal, (completed, total) => {
        setActiveProgress(6 + (completed / total) * 16, `Checking latency ${completed}/${total}`);
      });
      const latencyMs = percentile(latencyPoints, 0.5);
      const jitterMs = calculateJitter(latencyPoints);
      setActiveSummary({ latencyMs, jitterMs });

      setActiveProgress(25, 'Measuring download');
      const downloadMbps = await measureDownload(controller.signal, (completed, total, currentMbps) => {
        setActiveSummary({ downloadMbps: currentMbps });
        setActiveProgress(25 + (completed / total) * 38, `Measuring download ${completed}/${total}`);
      });

      setActiveProgress(68, 'Measuring upload');
      const uploadMbps = await measureUpload(controller.signal, (completed, total, currentMbps) => {
        setActiveSummary({ uploadMbps: currentMbps });
        setActiveProgress(68 + (completed / total) * 26, `Measuring upload ${completed}/${total}`);
      });

      const finalSummary: SpeedSummary = {
        downloadMbps,
        uploadMbps,
        latencyMs,
        jitterMs,
        testedAt: new Date().toISOString()
      };

      setSummary(finalSummary);
      setHistory((current) => [finalSummary, ...current].slice(0, 4));
      setProgress(100);
      setStatus('Finished');
    } catch (testError) {
      if (isAbortError(testError)) {
        setStatus('Stopped');
        return;
      }

      setError(errorMessage(testError));
      setStatus('Could not finish test');
    } finally {
      if (runIdRef.current === runId) {
        abortControllerRef.current = null;
        setRunning(false);
      }
    }
  }

  function pauseTest() {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setRunning(false);
    setStatus('Stopped');
  }

  return (
    <div className="speedtest-panel">
      <section className="speedtest-hero">
        <div>
          <span className="speedtest-kicker">
            <Wifi size={15} />
            Cloudflare network test
          </span>
          <h2>{summary?.downloadMbps !== undefined ? formatMbps(summary.downloadMbps) : '--'}</h2>
          <p>Download Mbps</p>
        </div>
        <div className="speedtest-controls">
          <button className="primary-button compact" type="button" onClick={startTest} disabled={running}>
            <Play size={15} />
            Start Test
          </button>
          {running && (
            <button className="addon-secondary-button" type="button" onClick={pauseTest}>
              <Square size={14} />
              Stop
            </button>
          )}
        </div>
      </section>

      <div className="speedtest-progress-row">
        <div className="speedtest-progress-bar" aria-label={`${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <span>{status}</span>
      </div>

      {error && (
        <div className="speedtest-error">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      <div className="speedtest-metrics-grid">
        <MetricCard label="Upload" value={formatOptional(summary?.uploadMbps, formatMbps)} suffix="Mbps" />
        <MetricCard label="Latency" value={formatOptional(summary?.latencyMs, formatMs)} suffix="ms" />
        <MetricCard label="Jitter" value={formatOptional(summary?.jitterMs, formatMs)} suffix="ms" />
        <MetricCard
          label="Packet Loss"
          value={summary?.packetLossPercent !== undefined ? `${summary.packetLossPercent.toFixed(1)}%` : 'Not tested'}
          suffix=""
        />
      </div>

      <div className="speedtest-note">
        <Activity size={15} />
        <span>Results are approximate and depend on the current network.</span>
      </div>

      <section className="speedtest-history">
        <div className="speedtest-section-heading">
          <Clock size={15} />
          <span>Recent results</span>
        </div>
        {history.length > 0 ? (
          <div className="speedtest-history-list">
            {history.map((item) => (
              <div className="speedtest-history-row" key={item.testedAt}>
                <strong>{formatMbps(item.downloadMbps)}</strong>
                <span>{formatTimestamp(item.testedAt)}</span>
                <span>{formatOptional(item.uploadMbps, formatMbps)} up</span>
                <span>{formatOptional(item.latencyMs, formatMs)} ping</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="speedtest-history-empty">No test history yet</div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, suffix, value }: { label: string; suffix: string; value: string }) {
  return (
    <div className="speedtest-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {suffix && <small>{suffix}</small>}
    </div>
  );
}

async function measureLatency(
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void
): Promise<number[]> {
  const samples: number[] = [];

  for (let index = 0; index < latencySampleCount; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${downloadApiUrl}?bytes=0&cacheBust=${cacheBust()}`, {
      cache: 'no-store',
      signal
    });
    await ensureResponse(response);
    await response.arrayBuffer();
    samples.push(performance.now() - startedAt);
    onProgress(index + 1, latencySampleCount);
  }

  return samples;
}

async function measureDownload(
  signal: AbortSignal,
  onProgress: (completed: number, total: number, currentMbps: number) => void
): Promise<number> {
  const samples: number[] = [];

  for (let index = 0; index < downloadSizes.length; index += 1) {
    const size = downloadSizes[index];
    const startedAt = performance.now();
    const response = await fetch(`${downloadApiUrl}?bytes=${size}&cacheBust=${cacheBust()}`, {
      cache: 'no-store',
      signal
    });
    await ensureResponse(response);
    const payload = await response.arrayBuffer();
    const elapsedMs = performance.now() - startedAt;
    const measuredBytes = Math.max(payload.byteLength, size);
    samples.push(bytesToMbps(measuredBytes, elapsedMs));
    onProgress(index + 1, downloadSizes.length, reduceBandwidth(samples));
  }

  return reduceBandwidth(samples);
}

async function measureUpload(
  signal: AbortSignal,
  onProgress: (completed: number, total: number, currentMbps: number) => void
): Promise<number> {
  const samples: number[] = [];

  for (let index = 0; index < uploadSizes.length; index += 1) {
    const size = uploadSizes[index];
    const payload = new Uint8Array(size);
    const startedAt = performance.now();
    const response = await fetch(`${uploadApiUrl}?cacheBust=${cacheBust()}`, {
      method: 'POST',
      body: payload,
      cache: 'no-store',
      signal
    });
    await ensureResponse(response);
    await response.text();
    samples.push(bytesToMbps(size, performance.now() - startedAt));
    onProgress(index + 1, uploadSizes.length, reduceBandwidth(samples));
  }

  return reduceBandwidth(samples);
}

async function ensureResponse(response: Response): Promise<void> {
  if (!response.ok) {
    throw new Error(`Cloudflare returned ${response.status}.`);
  }
}

function bytesToMbps(bytes: number, elapsedMs: number): number {
  if (!Number.isFinite(bytes) || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }

  return (bytes * 8) / (elapsedMs / 1000) / 1_000_000;
}

function reduceBandwidth(samples: number[]): number {
  return percentile(samples.filter((sample) => sample > 0), 0.8) ?? 0;
}

function percentile(values: number[], percentileValue: number): number | undefined {
  const sortedValues = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);

  if (sortedValues.length === 0) {
    return undefined;
  }

  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * percentileValue)));
  return sortedValues[index];
}

function calculateJitter(samples: number[]): number | undefined {
  if (samples.length < 2) {
    return undefined;
  }

  const deltas = samples.slice(1).map((sample, index) => Math.abs(sample - samples[index]));
  return deltas.reduce((total, delta) => total + delta, 0) / deltas.length;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `Speed test failed: ${error.message}`;
  }

  return 'Speed test failed. Check your network and try again.';
}

function cacheBust(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatMbps(value: number | undefined): string {
  if (value === undefined) {
    return '--';
  }

  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatMs(value: number | undefined): string {
  if (value === undefined) {
    return '--';
  }

  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

function formatOptional(value: number | undefined, formatter: (nextValue: number | undefined) => string): string {
  return formatter(value);
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}
