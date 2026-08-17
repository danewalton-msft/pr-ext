import { canonicalPullRequestUrl, getPullRequests } from "./lib/azure-devops.js";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./lib/settings.js";

const ALARM_NAME = "sync-pull-requests";
const STORAGE_KEYS = {
  settings: "settings",
  status: "syncStatus"
};

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const settings = sanitizeSettings({
    ...DEFAULT_SETTINGS,
    ...stored[STORAGE_KEYS.settings]
  });
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: settings });
  await configureAlarm(settings.syncIntervalMinutes);
});

chrome.runtime.onStartup.addListener(async () => {
  const settings = await loadSettings();
  await configureAlarm(settings.syncIntervalMinutes);
  if (settings.token && settings.organization) {
    await syncPullRequests();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_NAME) {
    await syncPullRequests();
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === "local" && changes[STORAGE_KEYS.settings]) {
    const settings = sanitizeSettings(changes[STORAGE_KEYS.settings].newValue);
    await configureAlarm(settings.syncIntervalMinutes);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "sync") {
    syncPullRequests()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "get-state") {
    getState().then(sendResponse);
    return true;
  }

  return false;
});

async function loadSettings() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.settings);
  return sanitizeSettings({
    ...DEFAULT_SETTINGS,
    ...stored[STORAGE_KEYS.settings]
  });
}

async function getState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.settings,
    STORAGE_KEYS.status
  ]);

  const settings = sanitizeSettings(stored[STORAGE_KEYS.settings]);
  return {
    configured: Boolean(settings.token && settings.organization),
    status: stored[STORAGE_KEYS.status] ?? null
  };
}

async function configureAlarm(periodInMinutes) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

async function syncPullRequests() {
  const settings = await loadSettings();

  if (!settings.token || !settings.organization) {
    const result = {
      ok: false,
      error: "Add an Azure DevOps organization and personal access token in Settings."
    };
    await saveStatus(result);
    return result;
  }

  try {
    const pullRequests = await getPullRequests(
      settings.organization,
      settings.token,
      settings.repositories
    );
    const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const reviewUrls = new Set(pullRequests.reviewRequested.map(({ url }) => url));
    const authored = pullRequests.authored.filter(({ url }) => !reviewUrls.has(url));

    await syncGroup({
      pullRequests: authored,
      title: settings.authoredGroupTitle,
      color: "blue",
      windowId: window.id,
      collapsed: settings.collapseGroups
    });
    await syncGroup({
      pullRequests: pullRequests.reviewRequested,
      title: settings.reviewGroupTitle,
      color: "red",
      windowId: window.id,
      collapsed: settings.collapseGroups
    });

    const result = {
      ok: true,
      displayName: pullRequests.displayName,
      projectCount: pullRequests.projectCount,
      repositoryCount: pullRequests.repositoryCount,
      skippedRepositories: pullRequests.skippedRepositories,
      authoredCount: pullRequests.authored.length,
      reviewCount: pullRequests.reviewRequested.length,
      syncedAt: new Date().toISOString()
    };
    await saveStatus(result);
    await updateBadge(pullRequests.reviewRequested.length);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      error: friendlyError(error),
      syncedAt: new Date().toISOString()
    };
    await saveStatus(result);
    await updateBadge(null);
    return result;
  }
}

async function syncGroup({ pullRequests, title, color, windowId, collapsed }) {
  const existingGroups = await chrome.tabGroups.query({ windowId, title });
  const existingGroup = existingGroups[0];

  if (pullRequests.length === 0) {
    if (existingGroup) {
      const groupedTabs = await chrome.tabs.query({ groupId: existingGroup.id });
      if (groupedTabs.length > 0) {
        await chrome.tabs.ungroup(groupedTabs.map(({ id }) => id));
      }
    }
    return;
  }

  const tabs = await chrome.tabs.query({ windowId });
  const tabsByUrl = new Map();

  for (const tab of tabs) {
    if (!tab.url) {
      continue;
    }

    try {
      tabsByUrl.set(canonicalPullRequestUrl(tab.url), tab);
    } catch {
      // Internal browser pages and invalid URLs cannot represent Azure DevOps PRs.
    }
  }

  const tabIds = [];
  for (const pullRequest of pullRequests) {
    let tab = tabsByUrl.get(pullRequest.url);

    if (!tab) {
      tab = await chrome.tabs.create({
        url: pullRequest.url,
        active: false,
        windowId
      });
      tabsByUrl.set(pullRequest.url, tab);
    }

    tabIds.push(tab.id);
  }

  const groupId = existingGroup
    ? await chrome.tabs.group({ groupId: existingGroup.id, tabIds })
    : await chrome.tabs.group({ createProperties: { windowId }, tabIds });

  await chrome.tabGroups.update(groupId, { title, color, collapsed });

  const groupedTabs = await chrome.tabs.query({ groupId });
  const currentTabIds = new Set(tabIds);
  const staleTabIds = groupedTabs
    .map(({ id }) => id)
    .filter((id) => !currentTabIds.has(id));
  if (staleTabIds.length > 0) {
    await chrome.tabs.ungroup(staleTabIds);
  }
}

async function saveStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.status]: status });
}

async function updateBadge(reviewCount) {
  await chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
  await chrome.action.setBadgeText({
    text: reviewCount === null ? "!" : reviewCount > 0 ? String(reviewCount) : ""
  });
}

function friendlyError(error) {
  if (error?.status === 401) {
    return "Azure DevOps rejected the token. Update it in Settings.";
  }
  if (error?.status === 403) {
    return "Azure DevOps denied access. Check the token scopes and organization.";
  }
  return error?.message || "The pull request sync failed.";
}
