# Cross-browser Manual Smoke Test

Run this checklist before distributing either browser package and before promoting a Firefox beta to a public AMO listing.

## Build and load

```sh
npm ci
npm run build:all
```

### Chrome

1. Open `chrome://extensions/` and enable developer mode.
2. Choose **Load unpacked** and select `dist/chrome/`.
3. Confirm the extension is named **Video Speed Controller**.

### Firefox Stable and ESR

Repeat the Firefox checklist in both the current Stable and ESR releases.

1. Open `about:debugging#/runtime/this-firefox`.
2. Choose **Load Temporary Add-on** and select `dist/firefox/manifest.json`.
3. Confirm the extension is named **Video Speed Controller — Community**.
4. Open the popup and options page and confirm both render without errors.

## Core behavior

Use `tests/e2e/test-video.html`, YouTube, TikTok, and Amazon Prime for the following checks:

1. Start playback and confirm the controller appears at `1.00`.
2. Use the controller buttons and the `D`, `S`, `R`, `Z`, `X`, and `V` shortcuts.
3. Confirm speed, seeking, reset, and controller hide/show behavior all match the configured values.
4. Change an option, reload the page, and confirm the setting persists.
5. Disable the extension from the popup and confirm the active controller is removed.
6. Re-enable it, reload, and confirm the controller returns.
7. Inspect the page and extension consoles for bridge, storage, or background errors.

## Site matrix

### YouTube

- Controller autohide follows the player controls.
- Seeking, quality changes, fullscreen, and navigation to another video preserve correct behavior.

### TikTok

- Controllers do not duplicate as videos are mounted and recycled.
- Scrolling between videos adopts the active media and preserves the selected speed.

### Amazon Prime Video

- Playback starts with both the controller visible and hidden.
- Toggling the controller with `V` does not create a black video surface.
- Seeking, fullscreen, subtitles, and episode transitions remain usable.

## Result record

Record the browser version and mark every row as PASS, PARTIAL, or FAIL:

| Browser        | Generic fixture | YouTube | TikTok | Amazon Prime | Popup/options | Notes |
| -------------- | --------------- | ------- | ------ | ------------ | ------------- | ----- |
| Chrome Stable  |                 |         |        |              |               |       |
| Firefox Stable |                 |         |        |              |               |       |
| Firefox ESR    |                 |         |        |              |               |       |

Do not promote the Firefox beta while the settings handshake times out, the controller fails to attach, storage changes do not cross the bridge, disabling does not tear down the controller, or Amazon Prime shows the reported black-screen regression.
