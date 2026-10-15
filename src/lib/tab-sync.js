import { canonicalPullRequestUrl } from "./azure-devops.js";
import { isOldUnreviewedPullRequest } from "./provider-results.js";

export function filterTabGroupPullRequests(pullRequests, now = Date.now()) {
  const authoredUrls = new Set(pullRequests.authored.map(({ url }) => url));
  const excludedUrls = new Set([
    ...pullRequests.reviewRequested,
    ...pullRequests.assigned
  ].filter((pullRequest) =>
    !authoredUrls.has(pullRequest.url) &&
    isOldUnreviewedPullRequest(pullRequest, now)
  ).map(({ url }) => url));
  return {
    authored: pullRequests.authored,
    reviewRequested: pullRequests.reviewRequested.filter(
      ({ url }) => !excludedUrls.has(url)
    ),
    assigned: pullRequests.assigned.filter(
      ({ url }) => !excludedUrls.has(url)
    ),
    excludedUrls
  };
}

export function shouldGroupTab(tab, targetGroupId, splitViewIdNone = -1) {
  const isInTargetGroup = targetGroupId !== undefined &&
    tab.groupId === targetGroupId;

  return !isInTargetGroup && !isInSplitView(tab, splitViewIdNone);
}

export function excludedManagedTabIds(
  tabs,
  managedUrls,
  excludedUrls,
  splitViewIdNone = -1
) {
  return tabs.filter((tab) =>
    !isInSplitView(tab, splitViewIdNone) &&
    tabMatchesUrls(tab, managedUrls) && tabMatchesUrls(tab, excludedUrls)
  ).map(({ id }) => id);
}

export function classifyStaleTabs(
  tabs,
  currentTabIds,
  staleManagedUrls,
  staleTabAction,
  splitViewIdNone = -1
) {
  const closeTabIds = [];
  const completeTabIds = [];
  const ungroupTabIds = [];

  for (const tab of tabs) {
    if (currentTabIds.has(tab.id)) {
      continue;
    }

    const wasManaged = tabMatchesUrls(tab, staleManagedUrls);

    if (wasManaged && staleTabAction === "close") {
      closeTabIds.push(tab.id);
    } else if (wasManaged && staleTabAction === "complete") {
      completeTabIds.push(tab.id);
    } else if (!isInSplitView(tab, splitViewIdNone)) {
      ungroupTabIds.push(tab.id);
    }
  }

  return { closeTabIds, completeTabIds, ungroupTabIds };
}

function isInSplitView(tab, splitViewIdNone) {
  return Number.isInteger(tab.splitViewId) &&
    tab.splitViewId !== splitViewIdNone;
}

function tabMatchesUrls(tab, urls) {
  if (!tab.url) {
    return false;
  }
  try {
    return urls.has(canonicalPullRequestUrl(tab.url));
  } catch {
    // Invalid and internal URLs were not opened as managed PR tabs.
    return false;
  }
}
