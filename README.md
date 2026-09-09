# AdsAway 1.1

AdsAway is a compatibility-first Manifest V3 Chrome extension for macOS. It blocks high-confidence advertising and popup networks while deliberately avoiding the page-JavaScript hooks that commonly break video players, login dialogs, and normal navigation.

## What changed in 1.1

Version 1.0 was too aggressive. It injected code into the page's MAIN world, replaced `window.open`, intercepted navigation, and used broad video-overlay heuristics. Those techniques could make legitimate websites malfunction.

Version 1.1 removes that architecture.

- No MAIN-world content script.
- No replacement of `window.open`.
- No Navigation API cancellation.
- No generic `/adserver/`, `popup.php`, or `/popunder` URL rules.
- No generic disabling of arbitrary elements over a video.
- Standard blocking uses only a curated set of high-confidence ad domains.
- Enhanced blocking is optional and OFF by default.
- Popup cleanup closes a new tab only after its destination matches a known ad host.
- Cosmetic cleanup only targets confirmed ad frames and strongly identified anti-adblock overlays.
- One-click **Pause here** bypasses AdsAway for a domain and reloads the page.
- A high-resolution red shield icon is supplied at multiple toolbar and extension-management sizes. The tooltip reflects active/paused state.

## Install on a MacBook

1. Download `AdsAway-Chrome-v1.1.0.zip`.
2. Double-click it in Finder.
3. Open Chrome and visit `chrome://extensions`.
4. Turn on **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `AdsAway` folder.
7. Open Chrome's Extensions menu and pin **AdsAway** if you want its red shield icon permanently in the upper-right toolbar.

Chrome controls toolbar pinning. Extensions can supply and update their toolbar icon, but the user chooses whether that icon is pinned.

## Protection layers

### Standard ad blocking — default ON
Uses Manifest V3 `declarativeNetRequest` to block high-confidence ad-network domains at the browser level.

### Popup shield — default ON
Watches newly created tabs that have an opener. It closes the tab only when its resolved URL belongs to a known ad/popup host. Legitimate unknown login, share, payment, and player tabs are left alone.

### Annoyance cleanup — default ON
Removes known ad frames and strongly identified anti-adblock overlays. It does not scan and disable arbitrary page controls.

### Enhanced blocking — default OFF
Adds a second set of less-universal ad networks. It is optional because unusual sites may rely on some of those services.

## If a site behaves strangely

Open AdsAway and click **Pause here**. AdsAway adds a high-priority allow rule for that domain, disables its cosmetic cleanup there, and reloads the page. You can later click **Resume here**.

## Files

- `manifest.json` — Manifest V3 definition
- `background.js` — ruleset state, popup-tab filtering, per-site bypass, toolbar icon state
- `content.js` / `content.css` — conservative cosmetic cleanup
- `rules/core.json` — Standard high-confidence network rules
- `rules/enhanced.json` — optional Enhanced rules
- `popup.html` / `popup.css` / `popup.js` — AdsAway control center
- `icons/` — red shield assets in multiple Chrome toolbar / management sizes

## License

MIT. The built-in domain rules are maintained directly in this repository and do not bundle third-party filter-list text.
