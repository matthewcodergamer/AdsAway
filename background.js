const DEFAULTS = {
  globalEnabled: true,
  strictPopups: true,
  disabledSites: []
};

const AD_HOSTS = new Set([
  "2mdn.net",
  "a-ads.com",
  "ad-maven.com",
  "adform.net",
  "adform.com",
  "adnxs.com",
  "adroll.com",
  "adskeeper.co.uk",
  "adsterra.com",
  "adsrvr.org",
  "adtechus.com",
  "advertising.com",
  "adxpremium.services",
  "amazon-adsystem.com",
  "bidswitch.net",
  "bidvertiser.com",
  "casalemedia.com",
  "clickadu.com",
  "clickaine.com",
  "connatix.com",
  "criteo.com",
  "criteo.net",
  "demdex.net",
  "doubleclick.net",
  "everesttech.net",
  "evadav.com",
  "exoclick.com",
  "galaksion.com",
  "googleadservices.com",
  "googlesyndication.com",
  "gumgum.com",
  "highperformancecpm.com",
  "highperformanceformat.com",
  "hilltopads.com",
  "hilltopads.net",
  "indexexchange.com",
  "juicyads.com",
  "lijit.com",
  "media.net",
  "mgid.com",
  "moatads.com",
  "monetag.com",
  "onclickalgo.com",
  "onclickperformance.com",
  "onclickprediction.com",
  "openx.net",
  "outbrain.com",
  "popads.net",
  "popcash.net",
  "popmonetizer.net",
  "propellerads.com",
  "pubmatic.com",
  "revcontent.com",
  "richads.com",
  "rubiconproject.com",
  "scorecardresearch.com",
  "sharethrough.com",
  "smartadserver.com",
  "spotxchange.com",
  "taboola.com",
  "teads.tv",
  "trafficjunky.net",
  "yieldmo.com",
  "zedo.com"
]);

const RESOURCE_TYPES = [
  "sub_frame","stylesheet","script","image","font","object","xmlhttprequest",
  "ping","media","websocket","webtransport","other"
];

const normalizeHost = (host = "") => host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

function hashDomain(domain) {
  let h = 2166136261;
  for (let i = 0; i < domain.length; i++) {
    h ^= domain.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1_000_000 + ((h >>> 0) % 1_000_000_000);
}

async function readSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return {
    globalEnabled: stored.globalEnabled !== false,
    strictPopups: stored.strictPopups !== false,
    disabledSites: Array.isArray(stored.disabledSites) ? stored.disabledSites.map(normalizeHost) : []
  };
}

async function syncNetworkProtection(settings) {
  settings = settings || await readSettings();
  const enabled = settings.globalEnabled;
  const current = await chrome.declarativeNetRequest.getEnabledRulesets();
  const hasCore = current.includes("adsaway_core");

  if (enabled && !hasCore) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: ["adsaway_core"] });
  } else if (!enabled && hasCore) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ["adsaway_core"] });
  }

  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const oldIds = old.filter(r => r.id >= 1_000_000).map(r => r.id);
  const addRules = enabled ? settings.disabledSites.map(domain => ({
    id: hashDomain(domain),
    priority: 10000,
    action: { type: "allow" },
    condition: {
      initiatorDomains: [domain],
      resourceTypes: RESOURCE_TYPES
    }
  })) : [];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: oldIds,
    addRules
  });
}

async function getTabStats(tabId) {
  const key = `tab:${tabId}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || { popups: 0, overlays: 0, suspiciousTabs: 0 };
}

async function setTabStats(tabId, stats) {
  const key = `tab:${tabId}`;
  await chrome.storage.session.set({ [key]: stats });
  const total = (stats.popups || 0) + (stats.overlays || 0) + (stats.suspiciousTabs || 0);
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d11a2a" });
  await chrome.action.setBadgeText({ tabId, text: total ? String(Math.min(total, 999)) : "" });
}

async function bump(tabId, kind, amount = 1) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const stats = await getTabStats(tabId);
  stats[kind] = (stats[kind] || 0) + amount;
  await setTabStats(tabId, stats);
}

async function isProtectionActiveForTab(tabId) {
  const settings = await readSettings();
  if (!settings.globalEnabled) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab?.url) return true;
    const host = normalizeHost(new URL(tab.url).hostname);
    return !settings.disabledSites.includes(host);
  } catch {
    return settings.globalEnabled;
  }
}

function isKnownAdHost(urlString) {
  try {
    const host = normalizeHost(new URL(urlString).hostname);
    for (const adHost of AD_HOSTS) {
      if (host === adHost || host.endsWith(`.${adHost}`)) return true;
    }
  } catch {}
  return false;
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.local.get(DEFAULTS);
  await chrome.storage.local.set({
    globalEnabled: current.globalEnabled !== false,
    strictPopups: current.strictPopups !== false,
    disabledSites: Array.isArray(current.disabledSites) ? current.disabledSites : []
  });
  await syncNetworkProtection();
});

chrome.runtime.onStartup.addListener(() => {
  syncNetworkProtection().catch(console.warn);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {});
});

const pendingPopupTabs = new Map();

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !tab.openerTabId) return;
  pendingPopupTabs.set(tab.id, { openerTabId: tab.openerTabId, createdAt: Date.now() });

  const candidate = tab.pendingUrl || tab.url;
  if (candidate && isKnownAdHost(candidate) && await isProtectionActiveForTab(tab.openerTabId)) {
    try {
      await chrome.tabs.remove(tab.id);
      await bump(tab.openerTabId, "suspiciousTabs");
    } catch {}
    pendingPopupTabs.delete(tab.id);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const pending = pendingPopupTabs.get(tabId);
  if (!pending) return;
  if (Date.now() - pending.createdAt > 7000) {
    pendingPopupTabs.delete(tabId);
    return;
  }
  const candidate = changeInfo.url || tab.pendingUrl || tab.url;
  if (candidate && isKnownAdHost(candidate) && await isProtectionActiveForTab(pending.openerTabId)) {
    try {
      await chrome.tabs.remove(tabId);
      await bump(pending.openerTabId, "suspiciousTabs");
    } catch {}
    pendingPopupTabs.delete(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return sendResponse({ ok: false });

    if (message.type === "reportBlocked") {
      const kind = ["popups", "overlays", "suspiciousTabs"].includes(message.kind) ? message.kind : "popups";
      if (sender.tab?.id != null) await bump(sender.tab.id, kind, Number(message.amount) || 1);
      return sendResponse({ ok: true });
    }

    if (message.type === "getState") {
      const settings = await readSettings();
      const host = normalizeHost(message.host || "");
      const stats = Number.isInteger(message.tabId) ? await getTabStats(message.tabId) : { popups: 0, overlays: 0, suspiciousTabs: 0 };
      return sendResponse({
        ok: true,
        settings,
        host,
        siteDisabled: !!host && settings.disabledSites.includes(host),
        stats
      });
    }

    if (message.type === "toggleGlobal") {
      const settings = await readSettings();
      settings.globalEnabled = !!message.enabled;
      await chrome.storage.local.set({ globalEnabled: settings.globalEnabled });
      await syncNetworkProtection({ ...settings, globalEnabled: settings.globalEnabled });
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "stateChanged" }).catch(() => {});
      }
      return sendResponse({ ok: true });
    }

    if (message.type === "toggleStrictPopups") {
      await chrome.storage.local.set({ strictPopups: !!message.enabled });
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id) chrome.tabs.sendMessage(tab.id, { type: "stateChanged" }).catch(() => {});
      }
      return sendResponse({ ok: true });
    }

    if (message.type === "toggleSite") {
      const host = normalizeHost(message.host || "");
      if (!host) return sendResponse({ ok: false, error: "No host" });
      const settings = await readSettings();
      const disabled = new Set(settings.disabledSites);
      if (message.disabled) disabled.add(host); else disabled.delete(host);
      settings.disabledSites = [...disabled].sort();
      await chrome.storage.local.set({ disabledSites: settings.disabledSites });
      await syncNetworkProtection(settings);
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          if (tab.id && tab.url && normalizeHost(new URL(tab.url).hostname) === host) {
            chrome.tabs.sendMessage(tab.id, { type: "stateChanged" }).catch(() => {});
          }
        } catch {}
      }
      return sendResponse({ ok: true, disabled: message.disabled });
    }

    if (message.type === "resetTabStats") {
      if (Number.isInteger(message.tabId)) {
        await setTabStats(message.tabId, { popups: 0, overlays: 0, suspiciousTabs: 0 });
      }
      return sendResponse({ ok: true });
    }

    sendResponse({ ok: false, error: "Unknown message" });
  })().catch(err => sendResponse({ ok: false, error: String(err?.message || err) }));

  return true;
});
