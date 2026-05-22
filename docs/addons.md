# Float AI Add-ons

Float AI add-ons are first-party bundled panels in this version. ScratchPad and SpeedTest ship inside the app, install by writing local state, and never execute arbitrary downloaded JavaScript.

## Current V1 Flow

- Marketplace data comes from the local `addonsRegistry` module.
- Installing a built-in add-on writes its installed version and enabled state to local app storage.
- Uninstalling removes only the installed add-on state.
- Built-in add-on data, such as ScratchPad notes, is kept in separate local storage so it can be synced later without changing the marketplace model.

## Future Community Registry

Community add-ons should live in one reviewed GitHub repository with a single registry and one folder per add-on:

```text
float-ai-addons/
  registry.json
  addons/
    scratchpad/
      addon.json
      icon.png
      README.md
    speedtest/
      addon.json
      icon.png
      README.md
```

Each add-on should provide an `addon.json`, icon, package zip, version, SHA256 hash, permissions, author, and changelog. Users would install, update, and uninstall add-ons from the marketplace after Float AI fetches `registry.json`.

Do not use separate Git branches per add-on. One registry with folders per add-on is easier to review, version, validate, and update.

## Required Safety Rules

- External add-on execution must be sandboxed.
- External add-ons must not receive Node.js access.
- Packages must be verified with SHA256 before extraction.
- CI should validate manifest schema, version format, icon presence, permissions, changelog, and package hash.
- Community add-ons should be submitted by pull request so the registry remains reviewable.

## Future Installer Steps

1. Fetch `registry.json` from GitHub.
2. Compare installed versions with registry versions.
3. Mark update availability in Marketplace and Installed.
4. Verify package SHA256.
5. Download package zip.
6. Extract into `userData/addons`.
7. Load the add-on through a sandboxed panel runtime.
