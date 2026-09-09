# AdsAway

AdsAway is a self-contained Manifest V3 Chrome extension for macOS. It targets the annoying ad behavior common on video and streaming pages: popup/popunder tabs, transparent click-catchers over video players, intrusive ad network requests, ad iframes, and common anti-adblock overlays.

The goal is not to disable the website. AdsAway tries to leave the actual Play, Pause, Fullscreen, volume, seek, captions, navigation, and other real controls usable.

## Protection layers

1. **Network shield** — Chrome `declarativeNetRequest` rules block a curated set of major ad and popunder networks before their requests complete.
2. **Popup shield** — the MAIN-world page guard intercepts unmatched `window.open()` calls and external popup attempts generated from player clicks.
3. **Video click-trap cleanup** — transparent or scripted overlays sitting over a real `<video>` element are made click-through when they match conservative ad-trap heuristics.
4. **Overlay cleanup** — known ad iframes, ad slots, and large anti-adblock overlays are removed while ordinary site dialogs are left alone.
5. **Ad-tab cleanup** — tabs that are opened by a page and resolve to a known ad host are closed automatically.
6. **Compatibility controls** — AdsAway can be paused globally or disabled for one site if a legitimate login/payment popup is needed.

## Install on a MacBook

1. Download `AdsAway-Chrome-v1.0.0.zip`.
2. Double-click it in Finder to extract the `AdsAway` folder.
3. Open Chrome and enter `chrome://extensions` in the address bar.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `AdsAway` folder.
7. Pin AdsAway from Chrome's Extensions menu if you want the protection controls visible.

Chrome does not install a normal unsigned ZIP by double-clicking it. `Load unpacked` is the correct installation path for this GitHub/development build.

## Toolbar controls

- Master protection toggle
- Strict popup shield toggle
- Enable/disable on the current website
- Per-tab counters for blocked popups, overlays, and ad tabs

## Files

- `manifest.json` — Manifest V3 configuration
- `rules/core.json` — self-contained static DNR blocking rules
- `page-guard.js` — popup/navigation protection in the page's MAIN world
- `content.js` — DOM cleanup, video click-trap detection, and settings bridge
- `background.js` — service worker, DNR state, per-site exceptions, counters, ad-tab cleanup
- `popup.html`, `popup.css`, `popup.js` — toolbar interface
- `icons/` — red AdsAway icon set
- `.github/workflows/package.yml` — validates and packages the downloadable ZIP on every push to `main`

## Scope

AdsAway blocks advertising and related intrusive page behavior. It does not bypass DRM, subscriptions, paywalls, CAPTCHAs, account restrictions, or other access controls.

## License

MIT.
