import { app, crashReporter } from 'electron';
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

type DiagnosticLevel = 'info' | 'warn' | 'error' | 'fatal';

type DiagnosticRecord = {
  timestamp: string;
  level: DiagnosticLevel;
  event: string;
  appVersion: string;
  pid: number;
  details?: unknown;
};

const maxLogBytes = 5 * 1024 * 1024;
const retainedLogFiles = 3;
const maximumStringLength = 4000;
const diagnosticFileName = 'float-ai.log';
let initialized = false;
let diagnosticDirectory = '';
let diagnosticFilePath = '';

export function initializeDiagnostics(): void {
  if (initialized) {
    return;
  }

  initialized = true;
  diagnosticDirectory = path.join(app.getPath('userData'), 'diagnostics');
  diagnosticFilePath = path.join(diagnosticDirectory, diagnosticFileName);

  try {
    mkdirSync(diagnosticDirectory, { recursive: true });
  } catch {
    // Logging must never prevent the application from starting.
  }

  try {
    crashReporter.start({
      productName: 'Float AI',
      uploadToServer: false,
      compress: true,
      globalExtra: {
        appVersion: app.getVersion()
      }
    });
  } catch (error) {
    logError('crash-reporter-start-failed', error);
  }

  installConsolePersistence();

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    logError('uncaught-exception', error, { origin }, 'fatal');
  });

  process.on('unhandledRejection', (reason) => {
    logError('unhandled-rejection', reason);
  });

  logInfo('app-process-started', {
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    crashDumpsPath: safeGetCrashDumpsPath()
  });
}

export function getDiagnosticsDirectory(): string {
  if (!diagnosticDirectory) {
    diagnosticDirectory = path.join(app.getPath('userData'), 'diagnostics');
  }

  return diagnosticDirectory;
}

export function logInfo(event: string, details?: unknown): void {
  writeDiagnosticRecord('info', event, details);
}

export function logWarn(event: string, details?: unknown): void {
  writeDiagnosticRecord('warn', event, details);
}

export function logError(
  event: string,
  error: unknown,
  details?: Record<string, unknown>,
  level: Extract<DiagnosticLevel, 'error' | 'fatal'> = 'error'
): void {
  writeDiagnosticRecord(level, event, {
    ...details,
    error: normalizeError(error)
  });
}

function installConsolePersistence(): void {
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    writeDiagnosticRecord('warn', 'console-warning', { message: formatConsoleArguments(args) });
    originalWarn(...args);
  };

  console.error = (...args: unknown[]) => {
    writeDiagnosticRecord('error', 'console-error', { message: formatConsoleArguments(args) });
    originalError(...args);
  };
}

function writeDiagnosticRecord(level: DiagnosticLevel, event: string, details?: unknown): void {
  if (!diagnosticFilePath) {
    return;
  }

  const record: DiagnosticRecord = {
    timestamp: new Date().toISOString(),
    level,
    event: sanitizeString(event),
    appVersion: app.getVersion(),
    pid: process.pid,
    ...(details === undefined ? {} : { details: normalizeValue(details) })
  };

  try {
    rotateLogsIfNeeded();
    appendFileSync(diagnosticFilePath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // A diagnostic write failure must never become an application failure.
  }
}

function rotateLogsIfNeeded(): void {
  if (!existsSync(diagnosticFilePath) || statSync(diagnosticFilePath).size < maxLogBytes) {
    return;
  }

  const oldestPath = `${diagnosticFilePath}.${retainedLogFiles}`;
  if (existsSync(oldestPath)) {
    rmSync(oldestPath, { force: true });
  }

  for (let index = retainedLogFiles - 1; index >= 1; index -= 1) {
    const sourcePath = `${diagnosticFilePath}.${index}`;
    if (existsSync(sourcePath)) {
      renameSync(sourcePath, `${diagnosticFilePath}.${index + 1}`);
    }
  }

  renameSync(diagnosticFilePath, `${diagnosticFilePath}.1`);
}

function normalizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) {
    return '[maximum-depth]';
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return normalizeError(value);
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => normalizeValue(entry, depth + 1));
  }

  if (typeof value === 'object') {
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      normalized[sanitizeString(key)] = normalizeValue(entry, depth + 1);
    }
    return normalized;
  }

  return sanitizeString(String(value));
}

function normalizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: sanitizeString(error.name),
      message: sanitizeString(error.message),
      stack: error.stack ? sanitizeString(error.stack) : undefined
    };
  }

  return {
    message: normalizeValue(error)
  };
}

function sanitizeString(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, '<url>')
    .replace(/(bearer\s+)[a-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/([?&](?:access_token|auth|code|key|token)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, maximumStringLength);
}

function formatConsoleArguments(args: unknown[]): string {
  return args
    .map((argument) => {
      if (argument instanceof Error) {
        return `${argument.name}: ${argument.message}`;
      }

      if (typeof argument === 'string') {
        return argument;
      }

      try {
        return JSON.stringify(normalizeValue(argument));
      } catch {
        return String(argument);
      }
    })
    .join(' ');
}

function safeGetCrashDumpsPath(): string | undefined {
  try {
    return app.getPath('crashDumps');
  } catch {
    return undefined;
  }
}
