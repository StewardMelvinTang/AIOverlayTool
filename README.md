# FloatAI Launcher

FloatAI Launcher is a Windows desktop Electron app that opens a floating, always-on-top AI launcher with a global shortcut. It uses a React + TypeScript renderer, Electron IPC, `electron-store` for local settings, a system tray menu, and an Electron `webview` for AI websites.

## Features

- Popup window toggled by `F20` by default.
- Integrated settings drawer inside the popup with Window, Providers, and Shortcut sections.
- Provider manager for ChatGPT, Claude, Gemini, and custom bookmarks.
- Bundled provider PNG icons plus a picker that copies custom PNG icons into app data.
- Popup sizing controlled from settings.
- Optional chrome transparency, always-on-top, remember position, hide-on-blur, launch-at-startup, and tray icon settings.
- Mouse back and forward buttons navigate the active provider page.
- System tray menu with Open Popup, Open Settings, and Quit.
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

## Windows Package

```bash
npm run dist
```

`electron-builder` outputs Windows installers/packages into `release/`.

## Local Settings

Settings are saved through `electron-store` under the app name `float-ai-launcher`.

```json
{
  "defaultProviderId": "chatgpt",
  "globalHotkey": "F20",
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
  }
}
```

## Shortcut Format

Electron global shortcuts use accelerator strings such as:

```text
F20
CommandOrControl+Space
Control+Alt+A
CommandOrControl+Shift+K
```

If a shortcut is already taken by Windows or another app, Electron may fail to register it. Choose another shortcut in Settings > Shortcuts.
