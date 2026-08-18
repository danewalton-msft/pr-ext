import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReviewDismissals,
  mergeProviderResults
} from "../src/lib/provider-results.js";

test("mergeProviderResults combines counts and deduplicates PR URLs", () => {
  const shared = {
    title: "PR",
    url: "https://github.com/octo/web/pull/1",
    updatedAt: "2026-01-01T00:00:00Z"
  };
  const result = mergeProviderResults([
    {
      displayName: "Ada",
      repositoryCount: 2,
      activePullRequestCount: 3,
      automationOwnedCount: 1,
      skippedRepositories: [],
      authored: [shared],
      reviewRequested: [],
      assigned: []
    },
    {
      displayName: "octocat",
      repositoryCount: 1,
      activePullRequestCount: 2,
      automationOwnedCount: 0,
      skippedRepositories: ["GitHub: octo/private"],
      authored: [shared],
      reviewRequested: [shared],
      assigned: [shared]
    }
  ]);

  assert.equal(result.displayName, "Ada · octocat");
  assert.equal(result.repositoryCount, 3);
  assert.equal(result.activePullRequestCount, 5);
  assert.equal(result.authored.length, 1);
  assert.equal(result.reviewRequested.length, 1);
  assert.equal(result.assigned.length, 1);
});

test("applyReviewDismissals moves dismissed reviews into assigned", () => {
  const review = {
    title: "Review",
    url: "https://github.com/octo/web/pull/2",
    updatedAt: "2026-02-01T00:00:00Z"
  };
  const result = applyReviewDismissals({
    authored: [],
    reviewRequested: [review],
    assigned: []
  }, new Set([review.url, "https://example.com/stale"]));

  assert.deepEqual(result.reviewRequested, []);
  assert.deepEqual(result.assigned, [review]);
  assert.deepEqual([...result.activeDismissedUrls], [review.url]);
});
