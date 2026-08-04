# Float AI

Float AI is a macOS and Windows Electron app that opens a floating, always-on-top AI launcher with a global shortcut. It uses a React + TypeScript renderer, Electron IPC, `electron-store` for local settings, a menu bar/tray menu, and an Electron `webview` for AI websites.

## Download

Download the latest Windows installer from [GitHub Releases](https://github.com/StewardMelvinTang/AIOverlayTool/releases/latest). Run the `Float AI Setup` executable attached to the newest release.

Windows builds are currently unsigned, so Microsoft Defender SmartScreen may show an unknown-publisher warning.

## Features

- Popup window toggled by `Option+Space` on macOS and `F20` on Windows by default.
- Integrated settings drawer inside the popup with Window, Providers, and Shortcut sections.
- Provider manager for ChatGPT, Claude, Gemini, and custom bookmarks.
- Smooth, horizontally scrollable provider navigation with draggable toolbar spacing.
- Quick Ask window for sending a prompt to a selected provider without opening the full popup first.
- Built-in ScratchPad and simplified download/upload SpeedTest add-ons.
- Bundled provider PNG icons plus a picker that copies custom PNG icons into app data.
- Popup sizing controlled from settings.
- Optional chrome transparency, always-on-top, remember position, hide-on-blur, launch-at-startup, and tray/menu bar settings.
- Performance settings for Memory Saver and macOS hardware acceleration.
- Memory Saver unloads inactive AI pages and restores their last visited URL when reopened.
- Mouse back and forward buttons navigate the active provider page.
- macOS menu bar item (with Dock fallback when disabled) and Windows system tray menu with Open Popup, Open Settings, Refresh Pages, and Quit.
- Provider sign-in popups open inside a secured companion window that shares the provider cookie/session store.
- Automatic renderer recovery, rotating diagnostic logs, and resource snapshots for troubleshooting freezes or crashes.
- Portable backup export/import for moving settings, providers, custom icons, add-ons, and ScratchPad notes between macOS and Windows.
- AI pages load in Electron `webview`, not an iframe.

## Project Structure

```text
.
├─ src/
│  ├─ main.ts                  # Electron main process
│  ├─ preload.ts               # Context bridge API
│  ├─ shared/
│  │  ├─ bridge.ts             # IPC bridge types
│  │  └─ settings.ts           # Settings and provider defaults
│  └─ renderer/
│     ├─ App.tsx
│     ├─ main.tsx
│     ├─ styles.css
│     ├─ global.d.ts
│     └─ components/
│        └─ PopupWindow.tsx
├─ provider-icons/            # Bundled provider PNG icons
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tsconfig.electron.json
├─ tsconfig.renderer.json
└─ README.md
```

## Install

```bash
npm install
```

## Run in Development

```bash
npm run dev
```

The dev command compiles the Electron main/preload files, starts Vite for the React renderer, then opens Electron.

## Build

```bash
npm run build
```

## Native Packages

```bash
npm run dist:mac
npm run dist:win
```

`electron-builder` outputs installers/packages into `release/`. The generic `npm run dist` command builds for the current platform.

### macOS Behavior

- A new macOS install uses `Option+Space` as its default global shortcut. A user-selected shortcut, including `F20`, is preserved.
- Turning off the menu bar icon shows the Dock icon so the running app remains reachable; enabling the menu bar icon returns it to menu-bar utility mode.
- The floating popup is available across Spaces, including over full-screen apps.

For local macOS testing, `npm run pack:mac` creates an unpacked app with an ad-hoc signature. Publicly distributed DMG/ZIP builds should be signed and notarized with Apple credentials.

### Provider Login Windows

Provider pages and popup login windows use the same persistent web session, so popup-based sign-in can return authenticated cookies to the embedded provider page. Remote login popups remain isolated from Node.js and from the app preload bridge.

Some identity providers intentionally refuse sign-in from embedded desktop browsers. In those cases the app cannot safely bypass that provider policy; use a provider-supported sign-in route where available.

### Portable Backups

Use **Settings > Window > System > Backup** to export a versioned `.floatai-backup.json` file. The backup includes app settings, provider lists, custom provider icons, installed built-in add-ons, and ScratchPad notes, and it can be restored on macOS or Windows.

For security and cross-platform reliability, backups do not contain provider login sessions, cookies, or credentials. Sign in again after restoring on another computer.

## Local Settings

Settings are saved through `electron-store` under the app name `float-ai-launcher`.

```json
{
  "defaultProviderId": "chatgpt",
  "globalHotkey": "Option+Space",
  "popup": {
    "width": 900,
    "height": 700,
    "x": 1000,
    "y": 160,
    "opacity": 1,
    "blur": false,
    "alwaysOnTop": true,
    "rememberPosition": true,
    "hideOnBlur": false,
    "resizableInPopup": false
  },
  "providers": [
    {
      "id": "chatgpt",
      "name": "ChatGPT",
      "url": "https://chatgpt.com",
      "icon": "chatgpt"
    }
  ],
  "clipboard": {
    "copySelectedTextBeforeOpen": false,
    "autoPaste": false
  },
  "performance": {
    "hardwareAcceleration": true,
    "memorySaver": true,
    "memorySaverUnloadMinutes": 2
  }
}
```

## Shortcut Format

Electron global shortcuts use accelerator strings such as:

```text
F20
Option+Space
CommandOrControl+Space
Control+Alt+A
CommandOrControl+Shift+K
```

If a shortcut is already taken by the OS or another app, Electron may fail to register it. Choose another shortcut in Settings > Shortcuts.
