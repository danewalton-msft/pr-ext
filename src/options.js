import { DEFAULT_SETTINGS, sanitizeSettings } from "./lib/settings.js";

const form = document.querySelector("#settings-form");
const organization = document.querySelector("#organization");
const token = document.querySelector("#token");
const repositories = document.querySelector("#repositories");
const interval = document.querySelector("#interval");
const authoredTitle = document.querySelector("#authored-title");
const reviewTitle = document.querySelector("#review-title");
const collapsed = document.querySelector("#collapsed");
const staleAction = document.querySelector("#stale-action");
const status = document.querySelector("#status");
const scopeWarning = document.querySelector("#scope-warning");

const stored = await chrome.storage.local.get("settings");
const settings = sanitizeSettings({
  ...DEFAULT_SETTINGS,
  ...stored.settings
});

organization.value = settings.organization;
token.value = settings.token;
repositories.value = settings.repositories;
interval.value = String(settings.syncIntervalMinutes);
authoredTitle.value = settings.authoredGroupTitle;
reviewTitle.value = settings.reviewGroupTitle;
collapsed.checked = settings.collapseGroups;
staleAction.value = settings.staleTabAction;
updateScopeWarning();

repositories.addEventListener("input", updateScopeWarning);
interval.addEventListener("change", updateScopeWarning);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const nextSettings = sanitizeSettings({
    organization: organization.value,
    token: token.value,
    repositories: repositories.value,
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
    status.textContent = `Saved. Found ${result.authoredCount} authored and ${result.reviewCount} awaiting review from ${result.activePullRequestCount} active PRs across ${result.repositoryCount} repositories.${skipped}`;
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
  const isFullOrganizationScan = repositories.value.trim() === "";
  scopeWarning.hidden = !isFullOrganizationScan;
  scopeWarning.classList.toggle(
    "urgent",
    isFullOrganizationScan && Number(interval.value) < 15
  );
}
