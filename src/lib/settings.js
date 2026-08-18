export const DEFAULT_SETTINGS = Object.freeze({
  token: "",
  organization: "",
  repositories: "",
  syncIntervalMinutes: 15,
  authoredGroupTitle: "🚀 My open PRs",
  reviewGroupTitle: "👀 Review requested",
  collapseGroups: false
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
    collapseGroups: Boolean(value.collapseGroups)
  };
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function groupTitle(value, legacyDefault, currentDefault) {
  const title = nonEmptyString(value, currentDefault);
  return title === legacyDefault ? currentDefault : title;
}
