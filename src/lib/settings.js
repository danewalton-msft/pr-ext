export const DEFAULT_SETTINGS = Object.freeze({
  token: "",
  organization: "",
  syncIntervalMinutes: 15,
  authoredGroupTitle: "My open ADO PRs",
  reviewGroupTitle: "ADO review requested",
  collapseGroups: false
});

export function sanitizeSettings(value = {}) {
  const interval = Number(value.syncIntervalMinutes);

  return {
    token: typeof value.token === "string" ? value.token.trim() : "",
    organization: typeof value.organization === "string" ? value.organization.trim() : "",
    syncIntervalMinutes: Number.isFinite(interval) && interval >= 15 ? interval : 15,
    authoredGroupTitle: nonEmptyString(value.authoredGroupTitle, DEFAULT_SETTINGS.authoredGroupTitle),
    reviewGroupTitle: nonEmptyString(value.reviewGroupTitle, DEFAULT_SETTINGS.reviewGroupTitle),
    collapseGroups: Boolean(value.collapseGroups)
  };
}

function nonEmptyString(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
