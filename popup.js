let currentTab = null;
let host = "";
let state = null;

const $ = (id) => document.getElementById(id);

function normalizeHost(value = "") {
  return value.toLowerCase().replace(/^www\./, "");
}

function setProtectionUI(protectedNow) {
  document.body.dataset.protection = protectedNow ? "active" : "paused";
  const label = $("protectionLabel");
  if (label) label.textContent = protectedNow ? "Protected" : "Paused";
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function refresh() {
  currentTab = await getActiveTab();
  try {
    host = currentTab?.url ? normalizeHost(new URL(currentTab.url).hostname) : "";
  } catch {
    host = "";
  }

  const response = await chrome.runtime.sendMessage({
    type: "getState",
    tabId: currentTab?.id,
    host
  });

  if (!response?.ok) {
    document.body.dataset.protection = "paused";
    $("statusText").textContent = "Unable to read protection status";
    return;
  }

  state = response;

  $("globalToggle").checked = state.settings.globalEnabled;
  $("strictToggle").checked = state.settings.strictPopups;
  $("siteLabel").textContent = host || "This page";

  const protectedNow = state.settings.globalEnabled && !state.siteDisabled;
  setProtectionUI(protectedNow);

  $("statusText").textContent = protectedNow ? "Protection is active" : "Protection is paused";
  $("siteState").textContent = protectedNow
    ? "Ads and popups are being blocked"
    : "AdsAway is not filtering this site";
  $("siteToggle").textContent = state.siteDisabled ? "Enable on this site" : "Disable on this site";
  $("siteToggle").disabled = !host;

  $("popupCount").textContent = state.stats.popups || 0;
  $("overlayCount").textContent = state.stats.overlays || 0;
  $("tabCount").textContent = state.stats.suspiciousTabs || 0;
}

$("globalToggle").addEventListener("change", async (event) => {
  await chrome.runtime.sendMessage({ type: "toggleGlobal", enabled: event.target.checked });
  await refresh();
});

$("strictToggle").addEventListener("change", async (event) => {
  await chrome.runtime.sendMessage({ type: "toggleStrictPopups", enabled: event.target.checked });
  await refresh();
});

$("siteToggle").addEventListener("click", async () => {
  if (!host || !state) return;
  await chrome.runtime.sendMessage({
    type: "toggleSite",
    host,
    disabled: !state.siteDisabled
  });
  await refresh();
});

$("resetStats").addEventListener("click", async () => {
  if (!currentTab?.id) return;
  await chrome.runtime.sendMessage({ type: "resetTabStats", tabId: currentTab.id });
  await refresh();
});

refresh().catch((error) => {
  console.error(error);
  document.body.dataset.protection = "paused";
  $("statusText").textContent = "Protection status unavailable";
});
