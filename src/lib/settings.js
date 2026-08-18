export const DEFAULT_SETTINGS = Object.freeze({
  token: "",
  organization: "",
  repositories: "",
  githubToken: "",
  githubRepositories: "",
  automationAuthors: "Agency\nGitHub Copilot",
  syncIntervalMinutes: 15,
  authoredGroupTitle: "🚀 My open PRs",
  reviewGroupTitle: "👀 Review requested",
  assignedGroupTitle: "📌 Assigned / following",
  collapseGroups: false,
  staleTabAction: "complete"
});

export function sanitizeSettings(value = {}) {
  const interval = Number(value.syncIntervalMinutes);
  const repositories = routeRepositoryUrls(
    value.repositories,
    value.githubRepositories
  );

  return {
    token: typeof value.token === "string" ? value.token.trim() : "",
    organization: typeof value.organization === "string" ? value.organization.trim() : "",
    repositories: repositories.azure,
    githubToken: typeof value.githubToken === "string" ? value.githubToken.trim() : "",
    githubRepositories: repositories.github,
    automationAuthors: typeof value.automationAuthors === "string"
      ? value.automationAuthors.trim()
      : DEFAULT_SETTINGS.automationAuthors,
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
    assignedGroupTitle: nonEmptyString(
      value.assignedGroupTitle,
      DEFAULT_SETTINGS.assignedGroupTitle
    ),
    collapseGroups: Boolean(value.collapseGroups),
    staleTabAction: staleTabAction(value)
  };
}

export function routeRepositoryUrls(azureValue, githubValue) {
  const azure = [];
  const github = [];

  routeLines(azureValue, "azure", azure, github);
  routeLines(githubValue, "github", azure, github);

  return {
    azure: deduplicateLines(azure).join("\n"),
    github: deduplicateLines(github).join("\n")
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

function routeLines(value, defaultProvider, azure, github) {
  for (const line of String(value ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.includes("://")) {
      const hostname = new URL(trimmed).hostname;
      if (hostname === "github.com") {
        github.push(trimmed);
        continue;
      }
      if (hostname === "dev.azure.com") {
        azure.push(trimmed);
        continue;
      }
    }

    (defaultProvider === "azure" ? azure : github).push(trimmed);
  }
}

function deduplicateLines(lines) {
  const unique = new Map();
  for (const line of lines) {
    unique.set(line.toLowerCase(), line);
  }
  return [...unique.values()];
}
