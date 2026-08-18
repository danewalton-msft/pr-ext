import { canonicalPullRequestUrl } from "./azure-devops.js";

export function shouldGroupTab(tab, targetGroupId, splitViewIdNone = -1) {
  const isInTargetGroup = targetGroupId !== undefined &&
    tab.groupId === targetGroupId;
  const isInSplitView = Number.isInteger(tab.splitViewId) &&
    tab.splitViewId !== splitViewIdNone;

  return !isInTargetGroup && !isInSplitView;
}

export function classifyStaleTabs(
  tabs,
  currentTabIds,
  staleManagedUrls,
  staleTabAction
) {
  const closeTabIds = [];
  const completeTabIds = [];
  const ungroupTabIds = [];

  for (const tab of tabs) {
    if (currentTabIds.has(tab.id)) {
      continue;
    }

    let wasManaged = false;
    if (tab.url) {
      try {
        wasManaged = staleManagedUrls.has(canonicalPullRequestUrl(tab.url));
      } catch {
        // Invalid and internal URLs were not opened as managed PR tabs.
      }
    }

    if (wasManaged && staleTabAction === "close") {
      closeTabIds.push(tab.id);
    } else if (wasManaged && staleTabAction === "complete") {
      completeTabIds.push(tab.id);
    } else {
      ungroupTabIds.push(tab.id);
    }
  }

  return { closeTabIds, completeTabIds, ungroupTabIds };
}
