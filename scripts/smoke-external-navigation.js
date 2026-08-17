const { app, BrowserWindow } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testProfilePath = mkdtempSync(path.join(os.tmpdir(), 'float-ai-external-navigation-'));
const testUrl = 'zoommtg://zoom.us/join?confno=123456789';
let testWindow;
let timeout;
let finished = false;

app.setPath('userData', testProfilePath);

function finish(exitCode, message) {
  if (finished) {
    return;
  }

  finished = true;
  clearTimeout(timeout);

  if (exitCode === 0) {
    console.log(message);
  } else {
    console.error(message);
  }

  if (testWindow && !testWindow.isDestroyed()) {
    testWindow.destroy();
  }

  try {
    rmSync(testProfilePath, { recursive: true, force: true });
  } catch {
    // Temporary cleanup must not hide the smoke-test result.
  }

  app.exit(exitCode);
}

app.whenReady().then(async () => {
  testWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  testWindow.webContents.on('will-frame-navigate', (event) => {
    if (event.url !== testUrl) {
      return;
    }

    event.preventDefault();
    finish(0, 'external-navigation-electron-smoke: PASS (subframe zoommtg handoff intercepted)');
  });

  timeout = setTimeout(() => {
    finish(1, 'external-navigation-electron-smoke: FAIL (zoommtg subframe navigation was not intercepted)');
  }, 8000);

  const html = `
    <!doctype html>
    <meta charset="utf-8">
    <iframe id="launcher" src="about:blank"></iframe>
    <script>
      setTimeout(() => {
        document.getElementById('launcher').src = ${JSON.stringify(testUrl)};
      }, 50);
    </script>
  `;

  await testWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}).catch((error) => {
  finish(1, `external-navigation-electron-smoke: FAIL (${error instanceof Error ? error.message : String(error)})`);
});
