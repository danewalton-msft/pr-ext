const summary = document.querySelector("#summary");
const details = document.querySelector("#details");
const syncButton = document.querySelector("#sync");
const optionsButton = document.querySelector("#options");

syncButton.addEventListener("click", async () => {
  setBusy(true);
  const result = await chrome.runtime.sendMessage({ type: "sync" });
  renderResult(result);
  setBusy(false);
});

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());

const state = await chrome.runtime.sendMessage({ type: "get-state" });
if (!state.configured) {
  summary.textContent = "No PR provider is configured.";
  details.textContent = "Open Settings and configure Azure DevOps, GitHub, or both.";
  syncButton.disabled = true;
} else if (state.status) {
  renderResult(state.status);
} else {
  summary.textContent = "Ready to sync.";
  details.textContent = "No pull request sync has run yet.";
}

function renderResult(result) {
  if (!result?.ok) {
    summary.textContent = "Sync failed";
    details.textContent = result?.error ?? "An unexpected error occurred.";
    return;
  }

  summary.textContent =
    `${result.authoredCount} open · ${result.reviewCount} awaiting your review`;
  const skipped = result.skippedRepositories?.length
    ? ` · ${result.skippedRepositories.length} repos skipped`
    : "";
  details.textContent = result.authoredCount === 0 && result.reviewCount === 0
    ? `No matching PRs across ${result.repositoryCount} repositories${skipped} · Updated ${formatDate(result.syncedAt)}`
    : `Signed in as ${result.displayName}${skipped} · Updated ${formatDate(result.syncedAt)}`;
}

function setBusy(isBusy) {
  syncButton.disabled = isBusy;
  syncButton.textContent = isBusy ? "Syncing..." : "Sync pull requests";
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
