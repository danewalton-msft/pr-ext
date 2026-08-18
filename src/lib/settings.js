export const DEFAULT_SETTINGS = Object.freeze({
  token: "",
  organization: "",
  repositories: "",
  syncIntervalMinutes: 15,
  authoredGroupTitle: "🚀 My open PRs",
  reviewGroupTitle: "👀 Review requested",
  collapseGroups: false,
  staleTabAction: "complete"
});

export function sanitizeSettings(value = {}) {
  const interval = Number(value.syncIntervalMinutes);

  return {
    token: typeof value.token === "string" ? value.token.trim() : "",
    organization: typeof value.organization === "string" ? value.organization.trim() : "",
    repositories: typeof value.repositories === "string" ? value.repositories.trim() : "",
    syncIntervalMinutes: Number.isFinite(interval) && interval >= 5 ? interval : 15,
    authoredGroupTitle: groupTitle(
      value.authoredGroupTitle,
      "My open ADO PRs",
      DEFAULT_SETTINGS.authoredGroupTitle
    ),
    reviewGroupTitle: groupTitle(
      value.reviewGroupTitle,
      "ADO review requested",
      DEFAULT_SETTINGS.reviewGroupTitle
    ),
    collapseGroups: Boolean(value.collapseGroups),
    staleTabAction: staleTabAction(value)
  };
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function groupTitle(value, legacyDefault, currentDefault) {
  const title = nonEmptyString(value, currentDefault);
  return title === legacyDefault ? currentDefault : title;
}

function staleTabAction(value) {
  if (["complete", "close", "ungroup"].includes(value.staleTabAction)) {
    return value.staleTabAction;
  }
  return value.closeStaleTabs ? "close" : DEFAULT_SETTINGS.staleTabAction;
}
