(() => {
  if (window.__adsAwaySafeContentLoaded) return;
  window.__adsAwaySafeContentLoaded = true;

  const hostname = location.hostname.toLowerCase().replace(/^www\./, "");
  const STANDARD_AD_HOSTS = [
    "doubleclick.net","googlesyndication.com","googleadservices.com","adnxs.com","adsrvr.org",
    "casalemedia.com","criteo.com","criteo.net","openx.net","pubmatic.com","rubiconproject.com",
    "smartadserver.com","amazon-adsystem.com","scorecardresearch.com","moatads.com","taboola.com",
    "outbrain.com","mgid.com","revcontent.com","propellerads.com","popads.net","popcash.net",
    "exoclick.com","trafficjunky.net","juicyads.com","hilltopads.net","adsterra.com","monetag.com",
    "clickadu.com"
  ];
  const ENHANCED_AD_HOSTS = [
    "2mdn.net","a-ads.com","ad-maven.com","adform.net","adform.com","adroll.com","adskeeper.co.uk",
    "advertising.com","adxpremium.services","bidswitch.net","bidvertiser.com","clickaine.com","demdex.net",
    "everesttech.net","evadav.com","galaksion.com","gumgum.com","highperformancecpm.com",
    "highperformanceformat.com","hilltopads.com","indexexchange.com","lijit.com","onclickalgo.com",
    "onclickperformance.com","onclickprediction.com","popmonetizer.net","richads.com","sharethrough.com",
    "spotxchange.com","yieldmo.com","zedo.com"
  ];

  let state = {
    active: true,
    enhancedBlocking: false,
    popupShield: true,
    annoyanceCleanup: true
  };

  let observer = null;
  let sweepTimer = null;

  function hostFromUrl(value) {
    try {
      return new URL(value, location.href).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function hostMatches(host, list) {
    return list.some(domain => host === domain || host.endsWith(`.${domain}`));
  }

  function isKnownAdUrl(value) {
    const host = hostFromUrl(value);
    if (!host) return false;
    if (hostMatches(host, STANDARD_AD_HOSTS)) return true;
    return state.enhancedBlocking && hostMatches(host, ENHANCED_AD_HOSTS);
  }

  function report(key, amount = 1) {
    chrome.runtime.sendMessage({ type: "report", key, amount }).catch(() => {});
  }

  async function refreshState() {
    const stored = await chrome.storage.local.get({
      globalEnabled: true,
      enhancedBlocking: false,
      popupShield: true,
      annoyanceCleanup: true,
      disabledSites: []
    });
    const disabledSites = Array.isArray(stored.disabledSites) ? stored.disabledSites : [];
    state = {
      active: stored.globalEnabled !== false && !disabledSites.includes(hostname),
      enhancedBlocking: stored.enhancedBlocking === true,
      popupShield: stored.popupShield !== false,
      annoyanceCleanup: stored.annoyanceCleanup !== false
    };
    document.documentElement?.toggleAttribute("data-adsaway-paused", !state.active);
    if (state.active) scheduleSweep(0);
  }

  function strongAntiAdblockMatch(element) {
    if (!(element instanceof HTMLElement)) return false;
    const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 900).toLowerCase();
    if (!text) return false;
    if (!/(ad\s*block|adblocker|advertisement blocker)/i.test(text)) return false;
    if (!/(disable|turn off|remove|whitelist|allow|detected|enabled)/i.test(text)) return false;

    const style = getComputedStyle(element);
    if (!["fixed", "sticky"].includes(style.position)) return false;
    const rect = element.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    return area >= innerWidth * innerHeight * 0.24;
  }

  function clearBodyLockAfterOverlayRemoval() {
    for (const element of [document.documentElement, document.body]) {
      if (!element) continue;
      if (element.style.overflow === "hidden") element.style.removeProperty("overflow");
      if (element.style.overflowY === "hidden") element.style.removeProperty("overflow-y");
    }
  }

  function cleanKnownAdFrames(root = document) {
    let removed = 0;
    const nodes = [];
    if (root instanceof Element && root.matches("iframe[src],script[src]")) nodes.push(root);
    if (root.querySelectorAll) nodes.push(...root.querySelectorAll("iframe[src],script[src]"));
    for (const node of nodes) {
      if (isKnownAdUrl(node.getAttribute("src") || "")) {
        node.remove();
        removed++;
      }
    }
    return removed;
  }

  function cleanAntiAdblock(root = document) {
    if (!state.annoyanceCleanup) return 0;
    const selector = [
      "[class*='adblock' i]",
      "[id*='adblock' i]",
      "[class*='anti-ad' i]",
      "[id*='anti-ad' i]"
    ].join(",");
    const candidates = [];
    if (root instanceof Element && root.matches(selector)) candidates.push(root);
    if (root.querySelectorAll) candidates.push(...root.querySelectorAll(selector));

    let removed = 0;
    for (const element of candidates.slice(0, 80)) {
      if (element.isConnected && strongAntiAdblockMatch(element)) {
        element.remove();
        removed++;
      }
    }
    if (removed) clearBodyLockAfterOverlayRemoval();
    return removed;
  }

  function overlapRatio(a, b) {
    const left = Math.max(a.left, b.left);
    const top = Math.max(a.top, b.top);
    const right = Math.min(a.right, b.right);
    const bottom = Math.min(a.bottom, b.bottom);
    const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
    return overlap / Math.max(1, b.width * b.height);
  }

  function cleanKnownAdVideoLinks(root = document) {
    if (!state.popupShield) return 0;
    const anchors = [];
    if (root instanceof HTMLAnchorElement && root.href) anchors.push(root);
    if (root.querySelectorAll) anchors.push(...root.querySelectorAll("a[href]"));
    const videos = [...document.querySelectorAll("video")].filter(video => {
      const rect = video.getBoundingClientRect();
      return rect.width >= 120 && rect.height >= 70;
    });
    if (!videos.length) return 0;

    let disabled = 0;
    for (const anchor of anchors.slice(0, 300)) {
      if (!anchor.isConnected || !isKnownAdUrl(anchor.href)) continue;
      const style = getComputedStyle(anchor);
      if (!["absolute", "fixed", "sticky"].includes(style.position)) continue;
      const rect = anchor.getBoundingClientRect();
      const coversVideo = videos.some(video => overlapRatio(rect, video.getBoundingClientRect()) >= 0.35);
      if (!coversVideo) continue;
      anchor.dataset.adsawayClicktrap = "1";
      anchor.style.setProperty("pointer-events", "none", "important");
      disabled++;
    }
    return disabled;
  }

  function runSweep(root = document) {
    if (!state.active) return;
    const overlays = cleanKnownAdFrames(root) + cleanAntiAdblock(root);
    const clickTraps = cleanKnownAdVideoLinks(root);
    if (overlays) report("overlays", overlays);
    if (clickTraps) report("clickTraps", clickTraps);
  }

  function scheduleSweep(delay = 120) {
    if (!state.active || sweepTimer) return;
    sweepTimer = setTimeout(() => {
      sweepTimer = null;
      runSweep(document);
    }, delay);
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(mutations => {
      if (!state.active) return;
      let touched = false;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (
            node.matches?.("iframe[src],script[src],a[href],[class*='adblock' i],[id*='adblock' i],[class*='anti-ad' i],[id*='anti-ad' i]") ||
            node.querySelector?.("iframe[src],script[src],a[href],[class*='adblock' i],[id*='adblock' i],[class*='anti-ad' i],[id*='anti-ad' i]")
          ) {
            touched = true;
            break;
          }
        }
        if (touched) break;
      }
      if (touched) scheduleSweep(180);
    });
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
  }

  document.addEventListener("click", event => {
    if (!state.active || !state.popupShield || !event.isTrusted) return;
    const target = event.target instanceof Element ? event.target : null;
    const anchor = target?.closest("a[href]");
    if (!anchor || !isKnownAdUrl(anchor.href)) return;
    if (anchor.dataset.adsawayClicktrap === "1") {
      event.preventDefault();
      event.stopPropagation();
      report("clickTraps", 1);
    }
  }, true);

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "stateChanged") refreshState().catch(() => {});
  });

  refreshState().then(() => {
    startObserver();
    scheduleSweep(0);
  }).catch(() => {
    startObserver();
  });
})();
