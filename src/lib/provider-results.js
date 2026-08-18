export function mergeProviderResults(results) {
  return {
    displayName: results.map((result) => result.displayName).filter(Boolean).join(" · "),
    repositoryCount: sum(results, "repositoryCount"),
    skippedRepositories: results.flatMap(
      (result) => result.skippedRepositories ?? []
    ),
    activePullRequestCount: sum(results, "activePullRequestCount"),
    automationOwnedCount: sum(results, "automationOwnedCount"),
    authored: mergePullRequests(results.flatMap((result) => result.authored)),
    reviewRequested: mergePullRequests(
      results.flatMap((result) => result.reviewRequested)
    ),
    assigned: mergePullRequests(results.flatMap((result) => result.assigned ?? []))
  };
}

export function mergePullRequests(pullRequests) {
  const byUrl = new Map();

  for (const pullRequest of pullRequests) {
    byUrl.set(pullRequest.url, pullRequest);
  }

  return [...byUrl.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function applyReviewDismissals(pullRequests, dismissedUrls) {
  const requestedUrls = new Set(
    pullRequests.reviewRequested.map(({ url }) => url)
  );
  const activeDismissedUrls = new Set(
    [...dismissedUrls].filter((url) => requestedUrls.has(url))
  );
  const reviewRequested = pullRequests.reviewRequested.filter(
    ({ url }) => !activeDismissedUrls.has(url)
  );
  const reviewUrls = new Set(reviewRequested.map(({ url }) => url));
  const authored = pullRequests.authored.filter(
    ({ url }) => !reviewUrls.has(url)
  );
  const authoredUrls = new Set(authored.map(({ url }) => url));
  const dismissedReviews = pullRequests.reviewRequested.filter(
    ({ url }) => activeDismissedUrls.has(url) && !authoredUrls.has(url)
  );
  const assigned = mergePullRequests([
    ...pullRequests.assigned,
    ...dismissedReviews
  ]).filter(({ url }) => !reviewUrls.has(url) && !authoredUrls.has(url));

  return {
    authored,
    reviewRequested,
    assigned,
    activeDismissedUrls
  };
}

function sum(results, property) {
  return results.reduce((total, result) => total + (result[property] ?? 0), 0);
}
