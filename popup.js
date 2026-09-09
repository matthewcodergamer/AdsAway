let currentTab = null;
let currentState = null;
let currentHost = "";
let toastTimer = null;

const $ = id => document.getElementById(id);

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1900);
}

function hostFromUrl(urlString = "") {
  try {
    const url = new URL(urlString);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}

async function send(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "AdsAway could not complete that action");
  return response;
}

function render() {
  if (!currentState) return;
  const settings = currentState.settings;
  const active = currentState.active;
  const siteDisabled = currentState.siteDisabled;
  const normalWebPage = !!currentHost;

  $("globalToggle").checked = settings.globalEnabled;
  $("popupToggle").checked = settings.popupShield;
  $("cleanupToggle").checked = settings.annoyanceCleanup;
  $("enhancedToggle").checked = settings.enhancedBlocking;

  const hero = $("hero");
  hero.classList.toggle("paused", !active);
  hero.classList.toggle("active", active);
  $("heroIcon").src = "icons/icon128.png";

  if (!settings.globalEnabled) {
    $("statusEyebrow").textContent = "PROTECTION PAUSED";
    $("statusTitle").textContent = "AdsAway is turned off";
    $("statusDetail").textContent = "Turn protection back on when you want AdsAway to filter websites again.";
  } else if (siteDisabled) {
    $("statusEyebrow").textContent = "SITE BYPASSED";
    $("statusTitle").textContent = "This website is untouched";
    $("statusDetail").textContent = "AdsAway is paused only here so the site can load exactly as it normally would.";
  } else {
    $("statusEyebrow").textContent = "PROTECTION ACTIVE";
    $("statusTitle").textContent = "AdsAway is protecting this page";
    $("statusDetail").textContent = settings.enhancedBlocking
      ? "Enhanced mode is active. If a site behaves strangely, switch it off or pause AdsAway for that site."
      : "Standard mode blocks high-confidence ad networks without changing website JavaScript.";
  }

  $("siteName").textContent = normalWebPage ? currentHost : "Chrome internal page";
  $("siteHint").textContent = normalWebPage
    ? (siteDisabled ? "AdsAway is paused on this domain" : "Compatibility-safe protection")
    : "Extensions cannot filter this Chrome page";

  const siteButton = $("siteToggle");
  siteButton.disabled = !normalWebPage;
  siteButton.textContent = siteDisabled ? "Resume here" : "Pause here";
  siteButton.classList.toggle("resume", siteDisabled);

  $("popupCount").textContent = currentState.stats?.popupTabs || 0;
  $("overlayCount").textContent = currentState.stats?.overlays || 0;
  $("trapCount").textContent = currentState.stats?.clickTraps || 0;

  $("toolbarCard").hidden = currentState.toolbarPinned !== false;
}

async function refresh() {
  currentTab = await getActiveTab();
  currentHost = hostFromUrl(currentTab?.url || "");
  currentState = await send({
    type: "getState",
    tabId: currentTab?.id,
    url: currentTab?.url || ""
  });
  render();
}

async function withBusy(element, action) {
  element.disabled = true;
  try {
    await action();
  } catch (error) {
    showToast(error.message || "Something went wrong");
  } finally {
    element.disabled = false;
  }
}

$("globalToggle").addEventListener("change", event => {
  withBusy(event.currentTarget, async () => {
    await send({ type: "setGlobalEnabled", enabled: event.currentTarget.checked });
    await refresh();
    showToast(event.currentTarget.checked ? "Protection turned on" : "Protection paused");
  });
});

$("popupToggle").addEventListener("change", event => {
  withBusy(event.currentTarget, async () => {
    await send({ type: "setPopupShield", enabled: event.currentTarget.checked });
    await refresh();
    showToast(event.currentTarget.checked ? "Popup shield on" : "Popup shield off");
  });
});

$("cleanupToggle").addEventListener("change", event => {
  withBusy(event.currentTarget, async () => {
    await send({ type: "setAnnoyanceCleanup", enabled: event.currentTarget.checked });
    await refresh();
    showToast(event.currentTarget.checked ? "Overlay cleanup on" : "Overlay cleanup off");
  });
});

$("enhancedToggle").addEventListener("change", event => {
  withBusy(event.currentTarget, async () => {
    await send({ type: "setEnhancedBlocking", enabled: event.currentTarget.checked });
    await refresh();
    showToast(event.currentTarget.checked ? "Enhanced blocking on" : "Back to Standard mode");
  });
});

$("siteToggle").addEventListener("click", event => {
  withBusy(event.currentTarget, async () => {
    if (!currentHost) return;
    const disabling = !currentState.siteDisabled;
    await send({ type: "setSiteDisabled", host: currentHost, disabled: disabling });
    showToast(disabling ? "AdsAway paused here — reloading" : "AdsAway resumed — reloading");
    if (currentTab?.id) {
      setTimeout(() => chrome.tabs.reload(currentTab.id).catch(() => {}), 120);
      setTimeout(() => window.close(), 260);
    }
  });
});

$("resetStats").addEventListener("click", event => {
  withBusy(event.currentTarget, async () => {
    await send({ type: "resetTabStats", tabId: currentTab?.id });
    await refresh();
    showToast("Tab counters reset");
  });
});

$("reloadButton").addEventListener("click", async () => {
  if (currentTab?.id) {
    await chrome.tabs.reload(currentTab.id).catch(() => {});
    window.close();
  }
});

$("resetButton").addEventListener("click", event => {
  withBusy(event.currentTarget, async () => {
    await send({ type: "resetRecommended" });
    await refresh();
    showToast("Recommended compatibility settings restored");
  });
});

refresh().catch(error => {
  $("statusEyebrow").textContent = "ADS AWAY";
  $("statusTitle").textContent = "Extension loaded";
  $("statusDetail").textContent = "Open a normal website to manage protection for that page.";
  showToast(error.message || "Could not read this Chrome page");
});
