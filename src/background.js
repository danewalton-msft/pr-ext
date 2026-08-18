import {
  canonicalPullRequestUrl,
  getPullRequests as getAzurePullRequests
} from "./lib/azure-devops.js";
import { getGitHubPullRequests, GitHubApiError } from "./lib/github.js";
import {
  applyReviewDismissals,
  mergeProviderResults
} from "./lib/provider-results.js";
import { DEFAULT_SETTINGS, sanitizeSettings } from "./lib/settings.js";
import { classifyStaleTabs } from "./lib/tab-sync.js";

const ALARM_NAME = "sync-pull-requests";
const STORAGE_KEYS = {
  settings: "settings",
  status: "syncStatus",
  managedUrls: "managedPullRequestUrls",
  dismissedReviewUrls: "dismissedReviewUrls"
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
  if (hasConfiguredProvider(settings)) {
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

  if (message?.type === "get-pr-disposition") {
    getPullRequestDisposition(message.url)
      .then(sendResponse)
      .catch(() => sendResponse({ disposition: null }));
    return true;
  }

  if (message?.type === "set-review-dismissal") {
    setReviewDismissal(message.url, message.dismissed)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "set-review-dismissals") {
    setReviewDismissals(message.urls, message.dismissed)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
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
    configured: hasConfiguredProvider(settings),
    status: stored[STORAGE_KEYS.status] ?? null
  };
}

async function configureAlarm(periodInMinutes) {
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes });
}

async function syncPullRequests() {
  const settings = await loadSettings();

  const configurationError = validateProviderSettings(settings);
  if (configurationError) {
    const result = {
      ok: false,
      error: configurationError
    };
    await saveStatus(result);
    return result;
  }

  try {
    const providerRequests = [];
    if (settings.token && settings.organization) {
      providerRequests.push(getAzurePullRequests(
        settings.organization,
        settings.token,
        settings.repositories,
        settings.automationAuthors
      ));
    }
    if (settings.githubToken && settings.githubRepositories) {
      providerRequests.push(getGitHubPullRequests(
        settings.githubToken,
        settings.githubRepositories,
        settings.automationAuthors
      ));
    }
    const pullRequests = mergeProviderResults(
      await Promise.all(providerRequests)
    );
    const window = await chrome.windows.getLastFocused({ windowTypes: ["normal"] });
    const dismissedState = await chrome.storage.local.get(
      STORAGE_KEYS.dismissedReviewUrls
    );
    const disposition = applyReviewDismissals(
      pullRequests,
      new Set(dismissedState[STORAGE_KEYS.dismissedReviewUrls] ?? [])
    );
    const { authored, reviewRequested, assigned, activeDismissedUrls } =
      disposition;
    const currentManagedUrls = new Set([
      ...pullRequests.authored.map(({ url }) => url),
      ...pullRequests.reviewRequested.map(({ url }) => url),
      ...pullRequests.assigned.map(({ url }) => url)
    ]);
    const managedState = await chrome.storage.local.get(STORAGE_KEYS.managedUrls);
    const staleManagedUrls = new Set(
      (managedState[STORAGE_KEYS.managedUrls] ?? [])
        .filter((url) => !currentManagedUrls.has(url))
    );

    const completedTabIds = [];
    completedTabIds.push(...await syncGroup({
      pullRequests: authored,
      title: settings.authoredGroupTitle,
      color: "blue",
      windowId: window.id,
      collapsed: settings.collapseGroups,
      staleTabAction: settings.staleTabAction,
      staleManagedUrls
    }));
    completedTabIds.push(...await syncGroup({
      pullRequests: assigned,
      title: settings.assignedGroupTitle,
      color: "yellow",
      windowId: window.id,
      collapsed: settings.collapseGroups,
      staleTabAction: settings.staleTabAction,
      staleManagedUrls
    }));
    completedTabIds.push(...await syncGroup({
      pullRequests: reviewRequested,
      title: settings.reviewGroupTitle,
      color: "red",
      windowId: window.id,
      collapsed: settings.collapseGroups,
      staleTabAction: settings.staleTabAction,
      staleManagedUrls
    }));
    if (completedTabIds.length > 0) {
      await groupCompletedTabs(completedTabIds, window.id);
    }

    const result = {
      ok: true,
      displayName: pullRequests.displayName,
      repositoryCount: pullRequests.repositoryCount,
      skippedRepositories: pullRequests.skippedRepositories,
      activePullRequestCount: pullRequests.activePullRequestCount,
      authoredCount: authored.length,
      automationOwnedCount: pullRequests.automationOwnedCount,
      reviewCount: reviewRequested.length,
      assignedCount: assigned.length,
      actionableReviewUrls: reviewRequested.map(({ url }) => url),
      dismissedReviewUrls: [...activeDismissedUrls],
      actionableReviewItems: reviewRequested.map(summarizePullRequest),
      dismissedReviewItems: pullRequests.reviewRequested
        .filter(({ url }) => activeDismissedUrls.has(url))
        .map(summarizePullRequest),
      assignedItems: assigned.map((pullRequest) => ({
        ...summarizePullRequest(pullRequest),
        dismissed: activeDismissedUrls.has(pullRequest.url)
      })),
      syncedAt: new Date().toISOString()
    };
    await chrome.storage.local.set({
      [STORAGE_KEYS.status]: result,
      [STORAGE_KEYS.managedUrls]: [...currentManagedUrls],
      [STORAGE_KEYS.dismissedReviewUrls]: [...activeDismissedUrls]
    });
    await updateBadge(reviewRequested.length);
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

async function syncGroup({
  pullRequests,
  title,
  color,
  windowId,
  collapsed,
  staleTabAction,
  staleManagedUrls
}) {
  const existingGroups = await chrome.tabGroups.query({ windowId, title });
  const existingGroup = existingGroups[0];

  if (pullRequests.length === 0) {
    if (existingGroup) {
      const groupedTabs = await chrome.tabs.query({ groupId: existingGroup.id });
      return removeStaleTabs(
        groupedTabs,
        new Set(),
        staleManagedUrls,
        staleTabAction
      );
    }
    return [];
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
  return removeStaleTabs(
    groupedTabs,
    new Set(tabIds),
    staleManagedUrls,
    staleTabAction
  );
}

async function removeStaleTabs(
  groupedTabs,
  currentTabIds,
  staleManagedUrls,
  staleTabAction
) {
  const { closeTabIds, completeTabIds, ungroupTabIds } = classifyStaleTabs(
    groupedTabs,
    currentTabIds,
    staleManagedUrls,
    staleTabAction
  );

  if (closeTabIds.length > 0) {
    await chrome.tabs.remove(closeTabIds);
  }
  if (ungroupTabIds.length > 0) {
    await chrome.tabs.ungroup(ungroupTabIds);
  }
  return completeTabIds;
}

async function groupCompletedTabs(tabIds, windowId) {
  const title = "✅ Complete";
  const existingGroups = await chrome.tabGroups.query({ windowId, title });
  const groupId = existingGroups.length > 0
    ? await chrome.tabs.group({ groupId: existingGroups[0].id, tabIds })
    : await chrome.tabs.group({ createProperties: { windowId }, tabIds });
  await chrome.tabGroups.update(groupId, {
    title,
    color: "green",
    collapsed: true
  });
}

async function saveStatus(status) {
  await chrome.storage.local.set({ [STORAGE_KEYS.status]: status });
}

async function getPullRequestDisposition(value) {
  const url = canonicalPullRequestUrl(value);
  const stored = await chrome.storage.local.get(STORAGE_KEYS.status);
  const status = stored[STORAGE_KEYS.status];

  if (status?.dismissedReviewUrls?.includes(url)) {
    return { disposition: "dismissed" };
  }
  if (status?.actionableReviewUrls?.includes(url)) {
    return { disposition: "review" };
  }
  return { disposition: null };
}

async function setReviewDismissal(value, dismissed) {
  return setReviewDismissals([value], dismissed);
}

async function setReviewDismissals(values, dismissed) {
  const urls = [...new Set(values.map(canonicalPullRequestUrl))];
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.status,
    STORAGE_KEYS.dismissedReviewUrls
  ]);
  const status = stored[STORAGE_KEYS.status];
  const eligibleUrls = new Set(
    dismissed
      ? status?.actionableReviewUrls ?? []
      : status?.dismissedReviewUrls ?? []
  );
  const allowed = urls.length > 0 && urls.every((url) => eligibleUrls.has(url));

  if (!allowed) {
    return { ok: false, error: "One or more selected PRs are not eligible." };
  }

  const dismissedUrls = new Set(
    stored[STORAGE_KEYS.dismissedReviewUrls] ?? []
  );
  if (dismissed) {
    urls.forEach((url) => dismissedUrls.add(url));
  } else {
    urls.forEach((url) => dismissedUrls.delete(url));
  }
  await chrome.storage.local.set({
    [STORAGE_KEYS.dismissedReviewUrls]: [...dismissedUrls]
  });
  return syncPullRequests();
}

function summarizePullRequest(pullRequest) {
  return {
    title: pullRequest.title,
    url: pullRequest.url,
    repository: pullRequest.repository
  };
}

async function updateBadge(reviewCount) {
  await chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
  await chrome.action.setBadgeText({
    text: reviewCount === null ? "!" : reviewCount > 0 ? String(reviewCount) : ""
  });
}

function friendlyError(error) {
  if (error instanceof GitHubApiError) {
    if (error.status === 401) {
      return "GitHub rejected the token. Update it in Settings.";
    }
    if (error.status === 403) {
      return "GitHub denied access or its API rate limit was reached.";
    }
    return `GitHub: ${error.message}`;
  }
  if (error?.status === 401) {
    return "Azure DevOps rejected the token. Update it in Settings.";
  }
  if (error?.status === 403) {
    return "Azure DevOps denied access. Check the token scopes and organization.";
  }
  return error?.message || "The pull request sync failed.";
}

function hasConfiguredProvider(settings) {
  return Boolean(
    (settings.token && settings.organization) ||
    (settings.githubToken && settings.githubRepositories)
  );
}

function validateProviderSettings(settings) {
  const azurePartiallyConfigured = Boolean(settings.token || settings.organization);
  if (azurePartiallyConfigured && !(settings.token && settings.organization)) {
    return "Azure DevOps requires both an organization and personal access token.";
  }

  const githubPartiallyConfigured = Boolean(
    settings.githubToken || settings.githubRepositories
  );
  if (
    githubPartiallyConfigured &&
    !(settings.githubToken && settings.githubRepositories)
  ) {
    return "GitHub requires both a personal access token and repository list.";
  }

  return hasConfiguredProvider(settings)
    ? null
    : "Configure Azure DevOps, GitHub, or both in Settings.";
}
