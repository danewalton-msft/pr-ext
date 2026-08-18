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
    )
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

function sum(results, property) {
  return results.reduce((total, result) => total + (result[property] ?? 0), 0);
}
