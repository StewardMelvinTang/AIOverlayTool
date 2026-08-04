import { AlertCircle, Play, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type SpeedSummary = {
  downloadMbps?: number;
  uploadMbps?: number;
  latencyMs?: number;
  jitterMs?: number;
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

      setSummary((current) => ({ ...current, ...patch }));
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
        jitterMs
      };

      setSummary(finalSummary);
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
      <section className="speedtest-surface">
        <div className="speedtest-download-circle" aria-live="polite">
          <span>Download</span>
          <strong>{summary?.downloadMbps !== undefined ? formatMbps(summary.downloadMbps) : '--'}</strong>
          <small>Mbps</small>
        </div>

        <div className="speedtest-controls">
          <button className="speedtest-start-button" type="button" onClick={startTest} disabled={running}>
            <Play size={15} />
            {running ? 'Testing' : 'Start Test'}
          </button>
          {running && (
            <button className="speedtest-stop-button" type="button" onClick={pauseTest}>
              <Square size={14} />
              Stop
            </button>
          )}
        </div>

        <div className="speedtest-progress">
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

        <div className="speedtest-metrics">
          <Metric label="Upload" value={formatOptional(summary?.uploadMbps, formatMbps)} unit="Mbps" />
          <Metric label="Latency" value={formatOptional(summary?.latencyMs, formatMs)} unit="ms" />
          <Metric label="Jitter" value={formatOptional(summary?.jitterMs, formatMs)} unit="ms" />
        </div>
      </section>
    </div>
  );
}

function Metric({ label, unit, value }: { label: string; unit: string; value: string }) {
  return (
    <div className="speedtest-metric">
      <span>{label}</span>
      <strong>
        {value}
        <small>{unit}</small>
      </strong>
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
