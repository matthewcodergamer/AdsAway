const DEFAULTS = {
  globalEnabled: true,
  enhancedBlocking: false,
  popupShield: true,
  annoyanceCleanup: true,
  disabledSites: []
};

const STANDARD_RULESET = "adsaway_standard";
const ENHANCED_RULESET = "adsaway_enhanced";
const DYNAMIC_SITE_RULE_MIN = 100000;
const DYNAMIC_SITE_RULE_MAX = 199999;

const STANDARD_AD_HOSTS = new Set([
  "doubleclick.net","googlesyndication.com","googleadservices.com","adnxs.com","adsrvr.org",
  "casalemedia.com","criteo.com","criteo.net","openx.net","pubmatic.com","rubiconproject.com",
  "smartadserver.com","amazon-adsystem.com","scorecardresearch.com","moatads.com","taboola.com",
  "outbrain.com","mgid.com","revcontent.com","propellerads.com","popads.net","popcash.net",
  "exoclick.com","trafficjunky.net","juicyads.com","hilltopads.net","adsterra.com","monetag.com",
  "clickadu.com"
]);

const ENHANCED_AD_HOSTS = new Set([
  "2mdn.net","a-ads.com","ad-maven.com","adform.net","adform.com","adroll.com","adskeeper.co.uk",
  "advertising.com","adxpremium.services","bidswitch.net","bidvertiser.com","clickaine.com","demdex.net",
  "everesttech.net","evadav.com","galaksion.com","gumgum.com","highperformancecpm.com",
  "highperformanceformat.com","hilltopads.com","indexexchange.com","lijit.com","onclickalgo.com",
  "onclickperformance.com","onclickprediction.com","popmonetizer.net","richads.com","sharethrough.com",
  "spotxchange.com","yieldmo.com","zedo.com"
]);

const DNR_RESOURCE_TYPES = [
  "sub_frame","stylesheet","script","image","font","object","xmlhttprequest",
  "ping","media","websocket","webtransport","other"
];

const ACTIVE_ICONS = {
  16: "icons/icon16.png",
  24: "icons/icon24.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png"
};

const PAUSED_ICONS = ACTIVE_ICONS;

function normalizeHost(host = "") {
  return String(host).toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function hostFromUrl(urlString = "") {
  try {
    return normalizeHost(new URL(urlString).hostname);
  } catch {
    return "";
  }
}

function isHostMatch(host, domains) {
  for (const domain of domains) {
    if (host === domain || host.endsWith(`.${domain}`)) return true;
  }
  return false;
}

function isKnownAdUrl(urlString, enhanced = true) {
  const host = hostFromUrl(urlString);
  if (!host) return false;
  if (isHostMatch(host, STANDARD_AD_HOSTS)) return true;
  return enhanced && isHostMatch(host, ENHANCED_AD_HOSTS);
}

async function readSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return {
    globalEnabled: stored.globalEnabled !== false,
    enhancedBlocking: stored.enhancedBlocking === true,
    popupShield: stored.popupShield !== false,
    annoyanceCleanup: stored.annoyanceCleanup !== false,
    disabledSites: Array.isArray(stored.disabledSites)
      ? [...new Set(stored.disabledSites.map(normalizeHost).filter(Boolean))].sort()
      : []
  };
}

async function writeSettings(partial) {
  await chrome.storage.local.set(partial);
}

async function syncRules(settings = null) {
  settings = settings || await readSettings();
  const enabledRulesets = await chrome.declarativeNetRequest.getEnabledRulesets();
  const enabled = new Set(enabledRulesets);
  const enableRulesetIds = [];
  const disableRulesetIds = [];

  if (settings.globalEnabled) {
    if (!enabled.has(STANDARD_RULESET)) enableRulesetIds.push(STANDARD_RULESET);
    if (settings.enhancedBlocking && !enabled.has(ENHANCED_RULESET)) enableRulesetIds.push(ENHANCED_RULESET);
    if (!settings.enhancedBlocking && enabled.has(ENHANCED_RULESET)) disableRulesetIds.push(ENHANCED_RULESET);
  } else {
    if (enabled.has(STANDARD_RULESET)) disableRulesetIds.push(STANDARD_RULESET);
    if (enabled.has(ENHANCED_RULESET)) disableRulesetIds.push(ENHANCED_RULESET);
  }

  if (enableRulesetIds.length || disableRulesetIds.length) {
    await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds });
  }

  const dynamic = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = dynamic
    .map(rule => rule.id)
    .filter(id => id >= DYNAMIC_SITE_RULE_MIN && id <= DYNAMIC_SITE_RULE_MAX);

  const addRules = settings.globalEnabled
    ? settings.disabledSites.slice(0, 500).map((domain, index) => ({
        id: DYNAMIC_SITE_RULE_MIN + index,
        priority: 10000,
        action: { type: "allow" },
        condition: {
          initiatorDomains: [domain],
          resourceTypes: DNR_RESOURCE_TYPES
        }
      }))
    : [];

  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function protectionStateForUrl(urlString) {
  const settings = await readSettings();
  const host = hostFromUrl(urlString);
  const siteDisabled = !!host && settings.disabledSites.includes(host);
  return {
    settings,
    host,
    siteDisabled,
    active: settings.globalEnabled && !siteDisabled
  };
}

async function updateActionForTab(tabId, urlString) {
  if (!Number.isInteger(tabId)) return;
  const state = await protectionStateForUrl(urlString || "");
  const active = state.active;
  await Promise.allSettled([
    chrome.action.setIcon({ tabId, path: active ? ACTIVE_ICONS : PAUSED_ICONS }),
    chrome.action.setTitle({
      tabId,
      title: active ? "AdsAway — Protection on" : "AdsAway — Paused"
    })
  ]);
}

async function refreshAllActionIcons() {
  const tabs = await chrome.tabs.query({});
  await Promise.allSettled(tabs.map(tab => updateActionForTab(tab.id, tab.url || tab.pendingUrl || "")));
}

async function notifyMatchingTabs(host = null) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    if (host && hostFromUrl(tab.url || tab.pendingUrl || "") !== host) continue;
    chrome.tabs.sendMessage(tab.id, { type: "stateChanged" }).catch(() => {});
    updateActionForTab(tab.id, tab.url || tab.pendingUrl || "").catch(() => {});
  }
}

async function getTabStats(tabId) {
  if (!Number.isInteger(tabId)) return { popupTabs: 0, overlays: 0, clickTraps: 0 };
  const key = `tab:${tabId}`;
  const result = await chrome.storage.session.get(key);
  return result[key] || { popupTabs: 0, overlays: 0, clickTraps: 0 };
}

async function bumpStat(tabId, key, amount = 1) {
  if (!Number.isInteger(tabId)) return;
  const stats = await getTabStats(tabId);
  stats[key] = Math.max(0, (Number(stats[key]) || 0) + (Number(amount) || 1));
  await chrome.storage.session.set({ [`tab:${tabId}`]: stats });
}

async function resetToRecommended() {
  const settings = {
    globalEnabled: true,
    enhancedBlocking: false,
    popupShield: true,
    annoyanceCleanup: true,
    disabledSites: []
  };
  await chrome.storage.local.set(settings);
  await syncRules(settings);
  await notifyMatchingTabs();
  await refreshAllActionIcons();
  return settings;
}

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get(DEFAULTS);
  const migrated = {
    globalEnabled: existing.globalEnabled !== false,
    enhancedBlocking: existing.enhancedBlocking === true,
    popupShield: existing.popupShield !== false,
    annoyanceCleanup: existing.annoyanceCleanup !== false,
    disabledSites: Array.isArray(existing.disabledSites) ? existing.disabledSites : []
  };
  await chrome.storage.local.set(migrated);
  await syncRules(migrated);
  await refreshAllActionIcons();
});

chrome.runtime.onStartup.addListener(() => {
  Promise.allSettled([syncRules(), refreshAllActionIcons()]);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await updateActionForTab(tabId, tab.url || tab.pendingUrl || "");
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    updateActionForTab(tabId, changeInfo.url || tab.url || tab.pendingUrl || "").catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`tab:${tabId}`).catch(() => {});
  pendingPopupTabs.delete(tabId);
});

const pendingPopupTabs = new Map();

async function maybeCloseAdPopup(tabId, candidateUrl, openerTabId) {
  if (!candidateUrl || !Number.isInteger(openerTabId)) return false;
  const opener = await chrome.tabs.get(openerTabId).catch(() => null);
  if (!opener) return false;
  const state = await protectionStateForUrl(opener.url || opener.pendingUrl || "");
  if (!state.active || !state.settings.popupShield) return false;
  if (!isKnownAdUrl(candidateUrl, state.settings.enhancedBlocking)) return false;

  try {
    await chrome.tabs.remove(tabId);
    await bumpStat(openerTabId, "popupTabs", 1);
    return true;
  } catch {
    return false;
  }
}

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.id || !Number.isInteger(tab.openerTabId)) return;
  pendingPopupTabs.set(tab.id, { openerTabId: tab.openerTabId, createdAt: Date.now() });
  const candidate = tab.pendingUrl || tab.url;
  if (candidate && await maybeCloseAdPopup(tab.id, candidate, tab.openerTabId)) {
    pendingPopupTabs.delete(tab.id);
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const pending = pendingPopupTabs.get(tabId);
  if (!pending) return;
  if (Date.now() - pending.createdAt > 10000) {
    pendingPopupTabs.delete(tabId);
    return;
  }
  const candidate = changeInfo.url || tab.pendingUrl || tab.url;
  if (candidate && await maybeCloseAdPopup(tabId, candidate, pending.openerTabId)) {
    pendingPopupTabs.delete(tabId);
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (!message || typeof message !== "object") return sendResponse({ ok: false, error: "Invalid message" });

    if (message.type === "getState") {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
      const state = await protectionStateForUrl(message.url || sender.tab?.url || "");
      const stats = await getTabStats(tabId);
      let toolbarPinned = null;
      try {
        toolbarPinned = (await chrome.action.getUserSettings()).isOnToolbar;
      } catch {}
      return sendResponse({ ok: true, ...state, stats, toolbarPinned });
    }

    if (message.type === "report") {
      const allowed = new Set(["overlays", "clickTraps", "popupTabs"]);
      const key = allowed.has(message.key) ? message.key : null;
      if (key && sender.tab?.id != null) await bumpStat(sender.tab.id, key, message.amount || 1);
      return sendResponse({ ok: true });
    }

    if (message.type === "setGlobalEnabled") {
      await writeSettings({ globalEnabled: !!message.enabled });
      const settings = await readSettings();
      await syncRules(settings);
      await notifyMatchingTabs();
      return sendResponse({ ok: true });
    }

    if (message.type === "setEnhancedBlocking") {
      await writeSettings({ enhancedBlocking: !!message.enabled });
      const settings = await readSettings();
      await syncRules(settings);
      await notifyMatchingTabs();
      return sendResponse({ ok: true });
    }

    if (message.type === "setPopupShield") {
      await writeSettings({ popupShield: !!message.enabled });
      await notifyMatchingTabs();
      return sendResponse({ ok: true });
    }

    if (message.type === "setAnnoyanceCleanup") {
      await writeSettings({ annoyanceCleanup: !!message.enabled });
      await notifyMatchingTabs();
      return sendResponse({ ok: true });
    }

    if (message.type === "setSiteDisabled") {
      const host = normalizeHost(message.host || "");
      if (!host) return sendResponse({ ok: false, error: "This page has no website domain" });
      const settings = await readSettings();
      const disabled = new Set(settings.disabledSites);
      if (message.disabled) disabled.add(host); else disabled.delete(host);
      settings.disabledSites = [...disabled].sort();
      await writeSettings({ disabledSites: settings.disabledSites });
      await syncRules(settings);
      await notifyMatchingTabs(host);
      return sendResponse({ ok: true, siteDisabled: !!message.disabled });
    }

    if (message.type === "resetRecommended") {
      const settings = await resetToRecommended();
      return sendResponse({ ok: true, settings });
    }

    if (message.type === "resetTabStats") {
      const tabId = Number.isInteger(message.tabId) ? message.tabId : sender.tab?.id;
      if (Number.isInteger(tabId)) {
        await chrome.storage.session.set({ [`tab:${tabId}`]: { popupTabs: 0, overlays: 0, clickTraps: 0 } });
      }
      return sendResponse({ ok: true });
    }

    return sendResponse({ ok: false, error: "Unknown action" });
  })().catch(error => {
    console.warn("AdsAway message error", error);
    sendResponse({ ok: false, error: String(error?.message || error) });
  });
  return true;
});
