import { DEFAULT_SETTINGS, sanitizeSettings } from "./lib/settings.js";

const form = document.querySelector("#settings-form");
const organization = document.querySelector("#organization");
const token = document.querySelector("#token");
const repositories = document.querySelector("#repositories");
const githubToken = document.querySelector("#github-token");
const githubRepositories = document.querySelector("#github-repositories");
const automationAuthors = document.querySelector("#automation-authors");
const interval = document.querySelector("#interval");
const authoredTitle = document.querySelector("#authored-title");
const reviewTitle = document.querySelector("#review-title");
const collapsed = document.querySelector("#collapsed");
const staleAction = document.querySelector("#stale-action");
const status = document.querySelector("#status");
const scopeWarning = document.querySelector("#scope-warning");
const azurePatLink = document.querySelector("#azure-pat-link");

const stored = await chrome.storage.local.get("settings");
const settings = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  ...stored.settings
});

organization.value = settings.organization;
token.value = settings.token;
repositories.value = settings.repositories;
githubToken.value = settings.githubToken;
githubRepositories.value = settings.githubRepositories;
automationAuthors.value = settings.automationAuthors;
interval.value = String(settings.syncIntervalMinutes);
authoredTitle.value = settings.authoredGroupTitle;
reviewTitle.value = settings.reviewGroupTitle;
collapsed.checked = settings.collapseGroups;
staleAction.value = settings.staleTabAction;
updateScopeWarning();
updateAzurePatLink();

repositories.addEventListener("input", updateScopeWarning);
organization.addEventListener("input", () => {
  updateScopeWarning();
  updateAzurePatLink();
});
token.addEventListener("input", updateScopeWarning);
interval.addEventListener("change", updateScopeWarning);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextSettings = sanitizeSettings({
    organization: organization.value,
    token: token.value,
    repositories: repositories.value,
    githubToken: githubToken.value,
    githubRepositories: githubRepositories.value,
    automationAuthors: automationAuthors.value,
    syncIntervalMinutes: interval.value,
    authoredGroupTitle: authoredTitle.value,
    reviewGroupTitle: reviewTitle.value,
    collapseGroups: collapsed.checked,
    staleTabAction: staleAction.value
  });

  setBusy(true);
  await chrome.storage.local.set({ settings: nextSettings });
  const result = await chrome.runtime.sendMessage({ type: "sync" });

  if (result.ok) {
    const skipped = result.skippedRepositories?.length
      ? ` Skipped ${result.skippedRepositories.length} inaccessible repositories.`
      : "";
    const automated = result.automationOwnedCount
      ? ` (${result.automationOwnedCount} automation-owned)`
      : "";
    status.textContent = `Saved. Found ${result.authoredCount} authored/owned${automated} and ${result.reviewCount} awaiting review from ${result.activePullRequestCount} active PRs across ${result.repositoryCount} repositories.${skipped}`;
    status.className = result.skippedRepositories?.length ? "warning" : "success";
  } else {
    status.textContent = result.error;
    status.className = "error";
  }
  setBusy(false);
});

function setBusy(isBusy) {
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = isBusy;
  submit.textContent = isBusy ? "Saving..." : "Save and sync";
}

function updateScopeWarning() {
  const isFullOrganizationScan =
    organization.value.trim() !== "" &&
    token.value.trim() !== "" &&
    repositories.value.trim() === "";
  scopeWarning.hidden = !isFullOrganizationScan;
  scopeWarning.classList.toggle(
    "urgent",
    isFullOrganizationScan && Number(interval.value) < 15
  );
}

function updateAzurePatLink() {
  const value = organization.value.trim();
  let organizationName = value;

  if (value.includes("://")) {
    try {
      [organizationName] = new URL(value).pathname.split("/").filter(Boolean);
    } catch {
      organizationName = "";
    }
  }

  azurePatLink.href = organizationName
    ? `https://dev.azure.com/${encodeURIComponent(organizationName)}/_usersSettings/tokens`
    : "https://dev.azure.com/";
}
