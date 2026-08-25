const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const { existsSync, mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const electronPath = require('electron');
const testProfilePath = mkdtempSync(path.join(os.tmpdir(), 'float-ai-memory-recovery-'));
const diagnosticsPath = path.join(testProfilePath, 'diagnostics', 'float-ai.log');

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><html><body><h1>Provider memory recovery smoke</h1></body></html>');
});

function finish(exitCode, output) {
  server.close();

  let diagnostics = '';
  if (existsSync(diagnosticsPath)) {
    diagnostics = readFileSync(diagnosticsPath, 'utf8');
  }

  const passed =
    exitCode === 0 &&
    diagnostics.includes('"event":"provider-webview-registered"') &&
    diagnostics.includes('"event":"provider-memory-recovery-smoke-test-forcing-crash"') &&
    diagnostics.includes('"event":"provider-memory-recovery-smoke-test-passed"');

  try {
    rmSync(testProfilePath, { recursive: true, force: true });
  } catch {
    // Electron may still be releasing a cache file; the OS temp directory can clean it later.
  }

  if (!passed) {
    console.error(`provider-memory-recovery-smoke: FAIL (exit ${exitCode})`);
    if (output.trim()) {
      console.error(output.trim());
    }
    if (diagnostics.trim()) {
      console.error(diagnostics.trim());
    }
    process.exitCode = 1;
    return;
  }

  console.log('provider-memory-recovery-smoke: PASS (registration, forced crash, and fresh webview recreation)');
}

server.listen(0, '127.0.0.1', () => {
  const address = server.address();
  if (!address || typeof address === 'string') {
    finish(1, 'Could not determine the local test server address.');
    return;
  }

  const child = spawn(electronPath, ['.'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      FLOAT_AI_USER_DATA_DIR: testProfilePath,
      FLOAT_AI_TEST_PROVIDER_MEMORY_RECOVERY_URL: `http://127.0.0.1:${address.port}/`
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  let output = '';
  const deadline = setTimeout(() => {
    output += '\nTimed out waiting for provider recovery.';
    child.kill();
  }, 30_000);

  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.once('error', (error) => {
    clearTimeout(deadline);
    finish(1, `${output}\n${error.stack ?? error.message}`);
  });
  child.once('exit', (code) => {
    clearTimeout(deadline);
    finish(code ?? 1, output);
  });
});
