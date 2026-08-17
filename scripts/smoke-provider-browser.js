const { app, BrowserWindow, ipcMain, webContents } = require('electron');
const { createServer } = require('node:http');
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const testProfilePath = mkdtempSync(path.join(os.tmpdir(), 'float-ai-provider-browser-'));
const expectedDownload = Buffer.alloc(512 * 1024, 0x46);
const downloadPath = path.join(testProfilePath, 'browser-download.bin');
let manager;
let server;
let finished = false;

app.setPath('userData', testProfilePath);
app.on('window-all-closed', () => {
  // Keep the smoke process alive long enough to assert WebContents cleanup.
});

function waitFor(predicate, timeoutMs = 10_000) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        const value = predicate();
        if (value) {
          resolve(value);
          return;
        }
      } catch (error) {
        reject(error);
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out after ${timeoutMs}ms.`));
        return;
      }

      setTimeout(poll, 40);
    };

    poll();
  });
}

async function finish(exitCode, message) {
  if (finished) {
    return;
  }

  finished = true;

  try {
    manager?.closeAll('smoke-test-finished');
    if (server) {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  } catch {
    // Cleanup must not hide the smoke-test result.
  }

  try {
    rmSync(testProfilePath, { recursive: true, force: true });
  } catch {
    // Electron may still be releasing profile files on Windows.
  }

  if (exitCode === 0) {
    console.log(message);
  } else {
    console.error(message);
  }

  app.exit(exitCode);
}

app.whenReady().then(async () => {
  const { ProviderBrowserManager } = require('../dist-electron/main/providerBrowserManager.js');

  server = createServer((request, response) => {
    if (request.url === '/download') {
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="browser-download.bin"',
        'Content-Length': expectedDownload.length
      });

      let offset = 0;
      const timer = setInterval(() => {
        const nextOffset = Math.min(expectedDownload.length, offset + 16 * 1024);
        response.write(expectedDownload.subarray(offset, nextOffset));
        offset = nextOffset;
        if (offset >= expectedDownload.length) {
          clearInterval(timer);
          response.end();
        }
      }, 20);
      return;
    }

    if (request.url === '/child') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><title>Child page</title><p>Child browser page</p>');
      return;
    }

    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(`
      <!doctype html>
      <title>Provider browser smoke</title>
      <a id="child" href="/child" target="_blank">Open child</a>
      <a id="download" href="/download" download>Download</a>
      <input id="upload" type="file">
    `);
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const pageUrl = `http://127.0.0.1:${address.port}/`;

  manager = new ProviderBrowserManager({
    appName: 'Float AI',
    sessionPartition: `float-ai-provider-browser-smoke-${Date.now()}`,
    toolbarHeight: 50,
    getParentWindow: () => null,
    getPreloadPath: () => path.join(projectRoot, 'dist-electron', 'preload.js'),
    getIconPath: () => path.join(projectRoot, 'icon_256.png'),
    loadToolbarRenderer: (window) => {
      void window.loadFile(path.join(projectRoot, 'dist-renderer', 'index.html'), {
        query: { window: 'browser' }
      });
    },
    shouldCaptureContent: () => false,
    shouldStayAlwaysOnTop: () => false,
    attachContentDiagnostics: () => {},
    openExternalUrl: () => {},
    logInfo: () => {},
    logWarn: () => {},
    logError: (_event, error) => {
      throw error;
    },
    isMac: process.platform === 'darwin'
  });

  ipcMain.handle('settings:get', () => ({ darkMode: true }));
  ipcMain.handle('providerBrowser:getState', (event) => manager.getStateForToolbar(event.sender));
  ipcMain.handle('providerBrowser:back', (event) => manager.goBack(event.sender));
  ipcMain.handle('providerBrowser:close', (event) => manager.close(event.sender));
  ipcMain.handle('providerBrowser:copyUrl', (event) => manager.copyCurrentUrl(event.sender));
  ipcMain.handle('providerBrowser:revealDownload', (event) => manager.revealDownload(event.sender));
  ipcMain.on('diagnostics:rendererError', () => {});

  if (!manager.open(pageUrl, 'smoke-test')) {
    throw new Error('Provider browser refused the local HTTP test page.');
  }

  const toolbarWindow = await waitFor(() => BrowserWindow.getAllWindows()[0]);
  const pageContents = await waitFor(() =>
    webContents.getAllWebContents().find((contents) => contents.getURL() === pageUrl)
  );
  const initialContentId = pageContents.id;

  if (process.env.FLOAT_AI_BROWSER_SMOKE_SCREENSHOT) {
    try {
      await waitFor(() => manager.getStateForToolbar(toolbarWindow.webContents)?.navigation.url === pageUrl);
      const toolbarImage = await toolbarWindow.webContents.capturePage({ x: 0, y: 0, width: 980, height: 50 });
      writeFileSync(process.env.FLOAT_AI_BROWSER_SMOKE_SCREENSHOT, toolbarImage.toPNG());
    } catch (error) {
      console.warn(`provider-browser-toolbar-capture: SKIP (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const hasFileInput = await pageContents.executeJavaScript(
    "document.querySelector('input[type=file]') instanceof HTMLInputElement",
    true
  );
  if (!hasFileInput) {
    throw new Error('The provider page file input was not available.');
  }

  await pageContents.executeJavaScript("document.getElementById('child').click()", true);
  await waitFor(() => BrowserWindow.getAllWindows().length === 2);

  const downloadDone = new Promise((resolve, reject) => {
    pageContents.session.once('will-download', (_event, item, sourceContents) => {
      if (sourceContents.id !== pageContents.id) {
        reject(new Error('Download came from the wrong web contents.'));
        return;
      }

      item.setSavePath(downloadPath);
      item.once('done', (_doneEvent, state) => {
        if (state !== 'completed') {
          reject(new Error(`Download finished in unexpected state: ${state}`));
          return;
        }
        resolve();
      });
    });
  });

  await pageContents.executeJavaScript("document.getElementById('download').click()", true);
  await waitFor(() => {
    const state = manager.getStateForToolbar(toolbarWindow.webContents);
    return state && ['starting', 'progressing'].includes(state.download.status) && state.download.activeCount === 1;
  });
  await downloadDone;

  const completedState = manager.getStateForToolbar(toolbarWindow.webContents);
  if (!completedState || completedState.download.status !== 'completed' || !completedState.download.canReveal) {
    throw new Error('Toolbar did not receive the completed download state.');
  }
  if (!existsSync(downloadPath) || !readFileSync(downloadPath).equals(expectedDownload)) {
    throw new Error('Downloaded bytes did not match the local server payload.');
  }

  const remoteContentIds = webContents
    .getAllWebContents()
    .filter((contents) => contents.getURL().startsWith(`http://127.0.0.1:${address.port}`))
    .map((contents) => contents.id);

  manager.closeAll('smoke-shortcut-hide');
  await waitFor(() => BrowserWindow.getAllWindows().length === 0);
  await waitFor(() => remoteContentIds.every((id) => webContents.fromId(id) === undefined));

  if (webContents.fromId(initialContentId) !== undefined || manager.hasOpenWindows()) {
    throw new Error('Provider browser web contents survived lifecycle cleanup.');
  }

  await finish(0, 'provider-browser-smoke: PASS (child popup, file input, download progress, save, and cleanup)');
}).catch((error) => {
  void finish(1, `provider-browser-smoke: FAIL (${error instanceof Error ? error.stack ?? error.message : String(error)})`);
});
