import SpeedTest, { type MeasurementConfig, type Results } from '@cloudflare/speedtest';
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

type SpeedTestEngine = InstanceType<typeof SpeedTest>;

const speedTestMeasurements: MeasurementConfig[] = [
  { type: 'latency', numPackets: 1 },
  { type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true },
  { type: 'latency', numPackets: 10 },
  { type: 'download', bytes: 1e5, count: 5 },
  { type: 'download', bytes: 1e6, count: 4 },
  { type: 'upload', bytes: 1e5, count: 4 },
  { type: 'upload', bytes: 1e6, count: 3 },
  { type: 'download', bytes: 1e7, count: 2 },
  { type: 'upload', bytes: 1e7, count: 2 }
];

export default function SpeedTestPanel() {
  const engineRef = useRef<SpeedTestEngine | null>(null);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('Ready');
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<SpeedSummary | null>(null);
  const [history, setHistory] = useState<SpeedSummary[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    return () => {
      engineRef.current?.pause();
      engineRef.current = null;
    };
  }, []);

  function startTest() {
    if (running) {
      return;
    }

    setError('');
    setProgress(0);
    setStatus('Preparing test');
    setSummary(null);
    engineRef.current?.pause();

    const engine = new SpeedTest({
      autoStart: false,
      measurements: speedTestMeasurements,
      measureDownloadLoadedLatency: true,
      measureUploadLoadedLatency: true,
      bandwidthFinishRequestDuration: 900
    });

    engine.onRunningChange = (isRunning) => {
      setRunning(isRunning);
      setStatus(isRunning ? 'Running test' : 'Test paused');
    };

    engine.onPhaseChange = ({ measurement, measurementId }) => {
      const nextProgress = Math.round(((measurementId + 1) / speedTestMeasurements.length) * 100);
      setProgress(Math.min(96, Math.max(8, nextProgress)));
      setStatus(formatPhase(measurement.type));
    };

    engine.onResultsChange = () => {
      setSummary(readSummary(engine.results));
    };

    engine.onFinish = (results) => {
      const finalSummary = readSummary(results);
      setSummary(finalSummary);
      setHistory((current) => [finalSummary, ...current].slice(0, 4));
      setProgress(100);
      setRunning(false);
      setStatus('Finished');
    };

    engine.onError = (message) => {
      setError(message || 'Speed test failed. Check your network and try again.');
      setRunning(false);
      setStatus('Could not finish test');
    };

    engineRef.current = engine;
    engine.play();
  }

  function pauseTest() {
    engineRef.current?.pause();
    setRunning(false);
    setStatus('Paused');
    // TODO: Add true request cancellation if Cloudflare exposes an abort API beyond pause().
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

function readSummary(results: Results): SpeedSummary {
  const summary = results.getSummary();

  return {
    downloadMbps: toMbps(summary.download),
    uploadMbps: toMbps(summary.upload),
    latencyMs: safeNumber(summary.latency),
    jitterMs: safeNumber(summary.jitter),
    packetLossPercent: summary.packetLoss === undefined ? undefined : safeNumber(summary.packetLoss * 100),
    testedAt: new Date().toISOString()
  };
}

function toMbps(value: number | undefined): number | undefined {
  const safeValue = safeNumber(value);
  return safeValue === undefined ? undefined : safeValue / 1_000_000;
}

function safeNumber(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function formatPhase(type: string): string {
  const labels: Record<string, string> = {
    download: 'Measuring download',
    latency: 'Measuring latency',
    upload: 'Measuring upload'
  };

  return labels[type] ?? 'Running test';
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value));
}
