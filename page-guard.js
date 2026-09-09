(() => {
  if (window.__adsAwayGuardInstalled) return;
  Object.defineProperty(window, "__adsAwayGuardInstalled", { value: true });

  let enabled = true;
  let strictPopups = true;
  let lastGesture = {
    at: 0,
    anchorUrl: null,
    mediaIntent: false,
    trusted: false
  };

  const nativeOpen = window.open.bind(window);

  const emitBlocked = (reason, url = "") => {
    try {
      document.dispatchEvent(new CustomEvent("adsaway:blocked", {
        detail: { kind: "popups", reason, url: String(url || "").slice(0, 500) }
      }));
    } catch {}
  };

  const safeUrl = (value) => {
    try {
      return new URL(String(value), location.href);
    } catch {
      return null;
    }
  };

  const sameOrigin = (url) => {
    const parsed = url instanceof URL ? url : safeUrl(url);
    return !!parsed && parsed.origin === location.origin;
  };

  const sameDestination = (a, b) => {
    const ua = a instanceof URL ? a : safeUrl(a);
    const ub = b instanceof URL ? b : safeUrl(b);
    if (!ua || !ub) return false;
    return ua.href === ub.href || (
      ua.origin === ub.origin &&
      ua.pathname === ub.pathname &&
      ua.search === ub.search
    );
  };

  const isMediaIntent = (target, event) => {
    if (!(target instanceof Element)) return false;
    if (target.closest("video,audio")) return true;

    const control = target.closest(
      "button,[role='button'],[aria-label],[title],[class*='player'],[class*='video'],[class*='control'],[id*='player'],[id*='video']"
    );
    if (control) {
      const label = [
        control.getAttribute("aria-label"),
        control.getAttribute("title"),
        typeof control.className === "string" ? control.className : "",
        control.id,
        control.textContent
      ].filter(Boolean).join(" ").toLowerCase();

      if (/(^|\W)(play|pause|fullscreen|full screen|volume|mute|unmute|seek|rewind|forward|quality|captions|player|video)(\W|$)/i.test(label)) {
        return true;
      }
    }

    if (event && document.querySelector("video")) {
      const videos = document.querySelectorAll("video");
      for (const video of videos) {
        const r = video.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const pad = 36;
        if (
          event.clientX >= r.left - pad && event.clientX <= r.right + pad &&
          event.clientY >= r.top - pad && event.clientY <= r.bottom + pad
        ) return true;
      }
    }

    return false;
  };

  const recordGesture = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href],area[href]");
    const anchorUrl = anchor ? safeUrl(anchor.href) : null;

    const mediaIntent = isMediaIntent(target, event);
    const externalMediaAnchor = !!anchorUrl && mediaIntent && anchorUrl.origin !== location.origin;

    lastGesture = {
      at: Date.now(),
      anchorUrl: externalMediaAnchor ? null : (anchorUrl?.href || null),
      mediaIntent,
      trusted: event.isTrusted
    };
  };

  document.addEventListener("pointerdown", recordGesture, true);
  document.addEventListener("click", recordGesture, true);

  document.addEventListener("click", (event) => {
    if (!enabled) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href],area[href]");
    const dest = anchor ? safeUrl(anchor.href) : null;

    // A common streaming-site trick is a transparent external link layered over
    // the player. Stop that navigation while leaving the real player underneath
    // available to receive clicks once the overlay cleanup has run.
    if (event.isTrusted && strictPopups && dest && !sameOrigin(dest) && isMediaIntent(target, event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      emitBlocked("media-click-external-link", dest.href);
      return;
    }

    // Page scripts sometimes synthesize clicks on target=_blank ad links.
    if (!event.isTrusted && anchor?.matches("[target='_blank']") && dest && !sameOrigin(dest)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      emitBlocked("synthetic-external-tab", dest.href);
    }
  }, true);

  window.open = function adsAwayWindowOpen(url, target, features) {
    if (!enabled || !strictPopups) {
      return nativeOpen(url, target, features);
    }

    const dest = safeUrl(url);
    const now = Date.now();
    const recentGesture = now - lastGesture.at <= 1600;

    if (dest && sameOrigin(dest)) {
      return nativeOpen(url, target, features);
    }

    if (
      dest &&
      recentGesture &&
      lastGesture.trusted &&
      lastGesture.anchorUrl &&
      sameDestination(dest, lastGesture.anchorUrl)
    ) {
      return nativeOpen(url, target, features);
    }

    if (!dest || String(url || "").trim() === "" || dest.href === "about:blank") {
      emitBlocked("blank-popup", url);
      return null;
    }

    emitBlocked(lastGesture.mediaIntent ? "media-control-popup" : "unmatched-popup", dest.href);
    return null;
  };

  try {
    window.open.toString = () => "function open() { [native code] }";
  } catch {}

  if ("navigation" in window && window.navigation?.addEventListener) {
    window.navigation.addEventListener("navigate", (event) => {
      if (!enabled || !strictPopups || event.navigationType === "traverse") return;

      const dest = safeUrl(event.destination?.url);
      if (!dest || sameOrigin(dest)) return;

      const recent = Date.now() - lastGesture.at <= 1200;
      const intendedAnchor = recent && lastGesture.anchorUrl && sameDestination(dest, lastGesture.anchorUrl);

      if (intendedAnchor) return;

      if (recent && lastGesture.trusted && lastGesture.mediaIntent && event.cancelable) {
        event.preventDefault();
        emitBlocked("media-click-navigation", dest.href);
      }
    });
  }

  document.addEventListener("adsaway:config", (event) => {
    const detail = event.detail || {};
    enabled = detail.enabled !== false;
    strictPopups = detail.strictPopups !== false;
  });
})();
