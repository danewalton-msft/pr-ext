import { canonicalPullRequestUrl } from "./lib/azure-devops.js";

const summary = document.querySelector("#summary");
const details = document.querySelector("#details");
const syncButton = document.querySelector("#sync");
const optionsButton = document.querySelector("#options");
const dismissButton = document.querySelector("#dismiss");
const reviewManager = document.querySelector("#review-manager");
const reviewList = document.querySelector("#review-list");
const dismissedSection = document.querySelector("#dismissed-section");
const dismissedList = document.querySelector("#dismissed-list");
const dismissSelectedButton = document.querySelector("#dismiss-selected");
const restoreSelectedButton = document.querySelector("#restore-selected");
const selectAllReviewsButton = document.querySelector("#select-all-reviews");
const selectAllDismissedButton = document.querySelector("#select-all-dismissed");
let currentPullRequestUrl = null;
let currentDisposition = null;

syncButton.addEventListener("click", async () => {
  setBusy(true);
  const result = await chrome.runtime.sendMessage({ type: "sync" });
  renderResult(result);
  setBusy(false);
});

optionsButton.addEventListener("click", () => chrome.runtime.openOptionsPage());
dismissButton.addEventListener("click", async () => {
  setBusy(true);
  const result = await chrome.runtime.sendMessage({
    type: "set-review-dismissal",
    url: currentPullRequestUrl,
    dismissed: currentDisposition === "review"
  });
  if (result.ok) {
    renderResult(result);
    await updateDisposition();
  } else {
    summary.textContent = "Could not update PR";
    details.textContent = result.error;
  }
  setBusy(false);
});
dismissSelectedButton.addEventListener("click", () =>
  updateSelectedReviews(reviewList, true)
);
restoreSelectedButton.addEventListener("click", () =>
  updateSelectedReviews(dismissedList, false)
);
selectAllReviewsButton.addEventListener("click", () =>
  selectAll(reviewList)
);
selectAllDismissedButton.addEventListener("click", () =>
  selectAll(dismissedList)
);

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
await initializeCurrentTab();

function renderResult(result) {
  if (!result?.ok) {
    summary.textContent = "Sync failed";
    details.textContent = result?.error ?? "An unexpected error occurred.";
    return;
  }

  const assignedCount = result.assignedCount ?? 0;
  summary.textContent =
    `${result.authoredCount} open · ${result.reviewCount} to review · ${assignedCount} following`;
  const skipped = result.skippedRepositories?.length
    ? ` · ${result.skippedRepositories.length} repos skipped`
    : "";
  details.textContent =
    result.authoredCount === 0 &&
    result.reviewCount === 0 &&
    assignedCount === 0
    ? `No matching PRs across ${result.repositoryCount} repositories${skipped} · Updated ${formatDate(result.syncedAt)}`
    : `Signed in as ${result.displayName}${skipped} · Updated ${formatDate(result.syncedAt)}`;
  renderReviewManager(result);
}

function setBusy(isBusy) {
  syncButton.disabled = isBusy;
  dismissButton.disabled = isBusy;
  dismissSelectedButton.disabled = isBusy;
  restoreSelectedButton.disabled = isBusy;
  selectAllReviewsButton.disabled = isBusy;
  selectAllDismissedButton.disabled = isBusy;
  syncButton.textContent = isBusy ? "Syncing..." : "Sync pull requests";
}

function renderReviewManager(result) {
  const actionable = result.actionableReviewItems ?? [];
  const following = result.assignedItems ??
    (result.dismissedReviewItems ?? []).map((item) => ({
      ...item,
      dismissed: true
    }));
  const hasOverrides = following.some((item) => item.dismissed);
  reviewManager.hidden = actionable.length === 0 && following.length === 0;
  dismissedSection.hidden = following.length === 0;
  dismissSelectedButton.hidden = actionable.length === 0;
  selectAllDismissedButton.hidden = !hasOverrides;
  restoreSelectedButton.hidden = !hasOverrides;
  renderPullRequestList(reviewList, actionable, "review");
  renderPullRequestList(
    dismissedList,
    following,
    "dismissed",
    (item) => item.dismissed
  );
}

function renderPullRequestList(
  container,
  items,
  prefix,
  isSelectable = () => true
) {
  container.replaceChildren();

  for (const [index, item] of items.entries()) {
    const label = document.createElement("label");
    label.className = "pr-checkbox";
    if (isSelectable(item)) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.url;
      checkbox.id = `${prefix}-${index}`;
      label.append(checkbox);
    } else {
      const marker = document.createElement("span");
      marker.className = "pr-marker";
      marker.textContent = "•";
      label.append(marker);
    }
    const text = document.createElement("span");
    const link = document.createElement("a");
    link.href = item.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = item.title;
    const repository = document.createElement("small");
    repository.textContent = item.repository;
    text.append(link, repository);
    label.append(text);
    container.append(label);
  }
}

async function updateSelectedReviews(container, dismissed) {
  const urls = [...container.querySelectorAll("input:checked")]
    .map((checkbox) => checkbox.value);
  if (urls.length === 0) {
    return;
  }

  setBusy(true);
  const result = await chrome.runtime.sendMessage({
    type: "set-review-dismissals",
    urls,
    dismissed
  });
  if (result.ok) {
    renderResult(result);
    await updateDisposition();
  } else {
    summary.textContent = "Could not update PRs";
    details.textContent = result.error;
  }
  setBusy(false);
}

async function initializeCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    return;
  }

  try {
    currentPullRequestUrl = canonicalPullRequestUrl(tab.url);
    await updateDisposition();
  } catch {
    currentPullRequestUrl = null;
  }
}

async function updateDisposition() {
  if (!currentPullRequestUrl) {
    dismissButton.hidden = true;
    return;
  }

  const result = await chrome.runtime.sendMessage({
    type: "get-pr-disposition",
    url: currentPullRequestUrl
  });
  currentDisposition = result.disposition;
  dismissButton.hidden = !currentDisposition || !reviewManager.hidden;
  dismissButton.textContent = currentDisposition === "review"
    ? "Move current review to 📌 Following"
    : "Restore current review request";
}

function selectAll(container) {
  container.querySelectorAll("input[type='checkbox']").forEach((checkbox) => {
    checkbox.checked = true;
  });
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
