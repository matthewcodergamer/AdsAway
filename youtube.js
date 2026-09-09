(() => {
  if (globalThis.__adsAwayYouTubeLoaded) return;
  globalThis.__adsAwayYouTubeLoaded = true;

  const host = location.hostname.toLowerCase().replace(/^www\./, "");
  let enabled = true;
  let sweepTimer = null;
  let savedMediaState = null;
  let lastReportAt = 0;

  const DISPLAY_AD_SELECTORS = [
    "#masthead-ad",
    "#player-ads",
    "ytd-ad-slot-renderer",
    "ytd-display-ad-renderer",
    "ytd-promoted-sparkles-web-renderer",
    "ytd-promoted-video-renderer",
    "ytd-in-feed-ad-layout-renderer",
    "ytd-action-companion-ad-renderer",
    "ytd-companion-slot-renderer",
    "ytd-video-masthead-ad-advertiser-info-renderer",
    "ytm-promoted-video-renderer"
  ];

  const SKIP_BUTTON_SELECTORS = [
    ".ytp-ad-skip-button",
    ".ytp-skip-ad-button",
    ".ytp-ad-skip-button-modern",
    "button.ytp-ad-skip-button-modern",
    ".ytp-ad-skip-button-container button",
    "button[class*='ytp-ad-skip']"
  ];

  const OVERLAY_CLOSE_SELECTORS = [
    ".ytp-ad-overlay-close-button",
    ".ytp-ad-overlay-close-container button"
  ];

  const AD_UI_SELECTORS = [
    ".ytp-ad-text",
    ".ytp-ad-preview-container",
    ".ytp-ad-preview-text",
    ".ytp-ad-duration-remaining",
    ".ytp-ad-simple-ad-badge",
    ".ytp-ad-skip-button-container",
    ".ytp-ad-player-overlay"
  ];

  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  async function refreshConfig() {
    try {
      const stored = await chrome.storage.local.get({
        globalEnabled: true,
        disabledSites: []
      });
      const disabledSites = Array.isArray(stored.disabledSites)
        ? stored.disabledSites.map(value => String(value).toLowerCase().replace(/^www\./, ""))
        : [];
      enabled = stored.globalEnabled !== false && !disabledSites.includes(host);
      if (!enabled) restoreMedia();
      else scheduleSweep(0);
    } catch {
      enabled = true;
    }
  }

  function report(amount = 1) {
    const now = Date.now();
    if (now - lastReportAt < 800) return;
    lastReportAt = now;
    try {
      chrome.runtime.sendMessage({ type: "reportBlocked", kind: "overlays", amount }).catch(() => {});
    } catch {}
  }

  function removeDisplayAds() {
    let removed = 0;

    for (const selector of DISPLAY_AD_SELECTORS) {
      for (const ad of document.querySelectorAll(selector)) {
        if (!(ad instanceof Element) || !ad.isConnected) continue;

        const feedWrapper = ad.closest(
          "ytd-rich-item-renderer,ytd-video-renderer,ytd-compact-video-renderer,ytd-grid-video-renderer"
        );

        if (feedWrapper && feedWrapper !== ad && feedWrapper.contains(ad)) {
          feedWrapper.remove();
        } else {
          ad.remove();
        }
        removed++;
      }
    }

    return removed;
  }

  function clickFirst(selectors) {
    for (const selector of selectors) {
      const candidates = document.querySelectorAll(selector);
      for (const button of candidates) {
        if (!(button instanceof HTMLElement) || !isVisible(button)) continue;
        try {
          button.click();
          return true;
        } catch {}
      }
    }
    return false;
  }

  function restoreMedia() {
    if (!savedMediaState) return;
    const { video, muted, playbackRate } = savedMediaState;
    savedMediaState = null;

    if (!(video instanceof HTMLMediaElement) || !video.isConnected) return;
    try { video.muted = muted; } catch {}
    try { video.playbackRate = playbackRate; } catch {}
  }

  function captureMedia(video) {
    if (savedMediaState?.video === video) return;
    restoreMedia();
    savedMediaState = {
      video,
      muted: video.muted,
      playbackRate: video.playbackRate
    };
  }

  function handlePlayerAd() {
    const player = document.querySelector(".html5-video-player");
    if (!(player instanceof HTMLElement) || !player.classList.contains("ad-showing")) {
      restoreMedia();
      return 0;
    }

    let actions = 0;
    if (clickFirst(SKIP_BUTTON_SELECTORS)) actions++;
    if (clickFirst(OVERLAY_CLOSE_SELECTORS)) actions++;

    const adUiPresent = AD_UI_SELECTORS.some(selector => document.querySelector(selector));
    if (!adUiPresent) return actions;

    const video = player.querySelector("video") || document.querySelector("video");
    if (!(video instanceof HTMLVideoElement)) return actions;

    captureMedia(video);

    try { video.muted = true; } catch {}

    const duration = Number(video.duration);
    if (Number.isFinite(duration) && duration > 0 && duration <= 600) {
      try {
        let end = duration;
        if (video.seekable?.length) {
          const seekEnd = video.seekable.end(video.seekable.length - 1);
          if (Number.isFinite(seekEnd) && seekEnd > 0) end = Math.min(duration, seekEnd);
        }

        if (end > video.currentTime + 0.35) {
          video.currentTime = Math.max(0, end - 0.05);
          actions++;
        } else if (video.playbackRate < 16) {
          video.playbackRate = 16;
          actions++;
        }
      } catch {
        try {
          if (video.playbackRate < 16) {
            video.playbackRate = 16;
            actions++;
          }
        } catch {}
      }
    } else {
      try {
        if (video.playbackRate < 16) {
          video.playbackRate = 16;
          actions++;
        }
      } catch {}
    }

    return actions;
  }

  function sweep() {
    sweepTimer = null;
    if (!enabled) return;

    let actions = removeDisplayAds();
    actions += handlePlayerAd();
    if (actions) report(Math.min(actions, 20));
  }

  function scheduleSweep(delay = 60) {
    if (!enabled || sweepTimer) return;
    sweepTimer = setTimeout(sweep, delay);
  }

  const observer = new MutationObserver(() => scheduleSweep());
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"]
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "stateChanged") refreshConfig();
  });

  addEventListener("yt-navigate-finish", () => scheduleSweep(0), true);
  addEventListener("load", () => scheduleSweep(0), { once: true });

  refreshConfig();
  setInterval(() => {
    if (enabled) sweep();
  }, 300);
})();
