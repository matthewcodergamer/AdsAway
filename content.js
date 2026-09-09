(() => {
  const hostname = location.hostname.toLowerCase().replace(/^www\./, "");
  const AD_HOSTS = [
    "2mdn.net","a-ads.com","ad-maven.com","adform.net","adnxs.com","adroll.com",
    "adskeeper.co.uk","adsterra.com","adsrvr.org","advertising.com","adxpremium.services",
    "amazon-adsystem.com","bidswitch.net","bidvertiser.com","casalemedia.com","clickadu.com",
    "clickaine.com","connatix.com","criteo.com","criteo.net","demdex.net","doubleclick.net",
    "everesttech.net","evadav.com","exoclick.com","galaksion.com","googleadservices.com",
    "googlesyndication.com","gumgum.com","highperformancecpm.com","highperformanceformat.com",
    "hilltopads.com","hilltopads.net","indexexchange.com","juicyads.com","lijit.com","media.net",
    "mgid.com","moatads.com","monetag.com","onclickalgo.com","onclickperformance.com",
    "onclickprediction.com","openx.net","outbrain.com","popads.net","popcash.net",
    "popmonetizer.net","propellerads.com","pubmatic.com","revcontent.com","richads.com",
    "rubiconproject.com","scorecardresearch.com","sharethrough.com","smartadserver.com",
    "spotxchange.com","taboola.com","teads.tv","trafficjunky.net","yieldmo.com","zedo.com"
  ];

  let enabled = true;
  let clickTrapTimer = null;

  const isAdHost = (url) => {
    try {
      const host = new URL(url, location.href).hostname.toLowerCase().replace(/^www\./, "");
      return AD_HOSTS.some(ad => host === ad || host.endsWith(`.${ad}`));
    } catch {
      return false;
    }
  };

  async function refreshConfig() {
    const stored = await chrome.storage.local.get({
      globalEnabled: true,
      strictPopups: true,
      disabledSites: []
    });
    const disabledSites = Array.isArray(stored.disabledSites) ? stored.disabledSites : [];
    enabled = stored.globalEnabled !== false && !disabledSites.includes(hostname);

    const root = document.documentElement;
    if (root) root.dataset.adsawayDisabled = enabled ? "false" : "true";

    document.dispatchEvent(new CustomEvent("adsaway:config", {
      detail: {
        enabled,
        strictPopups: stored.strictPopups !== false
      }
    }));

    if (enabled) cleanDocument();
  }

  function report(kind, amount = 1) {
    chrome.runtime.sendMessage({ type: "reportBlocked", kind, amount }).catch(() => {});
  }

  function isAntiAdblockOverlay(el) {
    if (!(el instanceof HTMLElement)) return false;

    const style = getComputedStyle(el);
    if (!["fixed", "sticky"].includes(style.position)) return false;

    const rect = el.getBoundingClientRect();
    const viewportArea = Math.max(1, innerWidth * innerHeight);
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area / viewportArea < 0.28) return false;

    const z = Number.parseInt(style.zIndex, 10);
    if (Number.isFinite(z) && z < 100) return false;

    const text = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 1200).toLowerCase();
    return /(disable|turn off|remove|whitelist|allow).{0,45}(ad ?block|adblocker)|ad ?block(er)?.{0,45}(detected|enabled|active)/i.test(text);
  }

  function restorePageScroll() {
    const html = document.documentElement;
    const body = document.body;
    for (const node of [html, body]) {
      if (!node) continue;
      const style = getComputedStyle(node);
      if (style.overflow === "hidden" || style.overflowY === "hidden") {
        node.style.setProperty("overflow", "auto", "important");
        node.style.setProperty("overflow-y", "auto", "important");
      }
    }
  }

  function cleanNode(node) {
    if (!enabled || !(node instanceof Element)) return 0;
    let removed = 0;

    if (node.matches("iframe[src],script[src]") && isAdHost(node.getAttribute("src"))) {
      node.remove();
      return 1;
    }

    if (node.matches("[data-ad-client],[data-ad-slot],ins.adsbygoogle")) {
      node.remove();
      return 1;
    }

    if (isAntiAdblockOverlay(node)) {
      node.remove();
      restorePageScroll();
      return 1;
    }

    for (const child of node.querySelectorAll?.("iframe[src],script[src],[data-ad-client],[data-ad-slot],ins.adsbygoogle") || []) {
      if (
        (child.matches("iframe[src],script[src]") && isAdHost(child.getAttribute("src"))) ||
        child.matches("[data-ad-client],[data-ad-slot],ins.adsbygoogle")
      ) {
        child.remove();
        removed++;
      }
    }

    const candidates = node.querySelectorAll?.("div,section,aside,dialog") || [];
    for (const candidate of candidates) {
      if (isAntiAdblockOverlay(candidate)) {
        candidate.remove();
        removed++;
      }
    }

    if (removed) restorePageScroll();
    scheduleClickTrapSweep();
    return removed;
  }

  function rectOverlapRatio(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
    return overlap / Math.max(1, b.width * b.height);
  }

  function hasPlayerSemantics(el) {
    const label = [
      el.getAttribute?.("aria-label"),
      el.getAttribute?.("title"),
      el.id,
      typeof el.className === "string" ? el.className : ""
    ].filter(Boolean).join(" ").toLowerCase();
    return /(player|video|controls?|play|pause|fullscreen|volume|seek|caption)/i.test(label);
  }

  function isLikelyClickTrap(el, video) {
    if (!(el instanceof HTMLElement) || !el.isConnected) return false;
    if (el === video || el.contains(video) || video.contains(el)) return false;
    if (el.dataset.adsawayClicktrap === "disabled") return false;
    if (hasPlayerSemantics(el)) return false;
    if (el.querySelector?.("button,[role='button'],input,select,video,audio")) return false;

    const style = getComputedStyle(el);
    if (style.pointerEvents === "none" || style.visibility === "hidden" || style.display === "none") return false;
    if (!["absolute", "fixed", "sticky"].includes(style.position)) return false;

    const vr = video.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (!vr.width || !vr.height || rectOverlapRatio(er, vr) < 0.45) return false;

    const z = Number.parseInt(style.zIndex, 10);
    if (Number.isFinite(z) && z < 2) return false;

    const anchor = el.matches("a[href]") ? el : null;
    if (anchor) {
      try {
        const dest = new URL(anchor.href, location.href);
        if (dest.origin !== location.origin) return true;
      } catch {}
    }

    const inlineHandler = ["onclick", "onmousedown", "onmouseup", "onpointerdown"]
      .some(name => el.hasAttribute(name));
    const dataTarget = ["data-href", "data-url", "data-link", "data-target"]
      .some(name => el.hasAttribute(name));
    const text = (el.innerText || "").replace(/\s+/g, " ").trim();
    const visuallyEmpty = !text && style.backgroundImage === "none";
    const nearlyInvisible = Number(style.opacity || "1") <= 0.15;

    return (inlineHandler || dataTarget) && (visuallyEmpty || nearlyInvisible);
  }

  function disableClickTrap(el) {
    if (!(el instanceof HTMLElement) || el.dataset.adsawayClicktrap === "disabled") return false;
    el.dataset.adsawayClicktrap = "disabled";
    el.style.setProperty("pointer-events", "none", "important");
    return true;
  }

  function cleanVideoClickTraps() {
    if (!enabled || !document.elementsFromPoint) return 0;
    let disabled = 0;

    for (const video of document.querySelectorAll("video")) {
      const r = video.getBoundingClientRect();
      if (r.width < 80 || r.height < 45 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;

      const points = [
        [r.left + r.width * 0.50, r.top + r.height * 0.50],
        [r.left + r.width * 0.15, r.top + r.height * 0.50],
        [r.left + r.width * 0.85, r.top + r.height * 0.50],
        [r.left + r.width * 0.50, r.top + r.height * 0.82],
        [r.left + r.width * 0.88, r.top + r.height * 0.88]
      ];

      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const stack = document.elementsFromPoint(x, y);
        for (const el of stack) {
          if (el === video || el.contains(video)) break;
          if (isLikelyClickTrap(el, video) && disableClickTrap(el)) {
            disabled++;
          }
        }
      }
    }

    return disabled;
  }

  function scheduleClickTrapSweep() {
    if (!enabled || clickTrapTimer) return;
    clickTrapTimer = setTimeout(() => {
      clickTrapTimer = null;
      const count = cleanVideoClickTraps();
      if (count) report("overlays", count);
    }, 100);
  }

  function cleanDocument() {
    if (!enabled) return;
    const target = document.documentElement || document;
    const removed = cleanNode(target);
    if (removed) report("overlays", removed);
    scheduleClickTrapSweep();
  }

  const observer = new MutationObserver((mutations) => {
    if (!enabled) return;
    let removed = 0;
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) removed += cleanNode(node);
      }
    }
    if (removed) report("overlays", removed);
    scheduleClickTrapSweep();
  });

  function startObserver() {
    const target = document.documentElement || document;
    observer.observe(target, { childList: true, subtree: true });
  }

  document.addEventListener("adsaway:blocked", () => {
    if (enabled) report("popups", 1);
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "stateChanged") refreshConfig().catch(() => {});
  });

  refreshConfig().catch(() => {});
  startObserver();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      refreshConfig().catch(() => {});
      cleanDocument();
      scheduleClickTrapSweep();
    }, { once: true });
  } else {
    cleanDocument();
  }

  addEventListener("load", scheduleClickTrapSweep, { once: true });
  addEventListener("resize", scheduleClickTrapSweep, { passive: true });
})();
