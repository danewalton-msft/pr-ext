import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReviewDismissals,
  isOldUnreviewedPullRequest,
  mergeProviderResults
} from "../src/lib/provider-results.js";

test("isOldUnreviewedPullRequest uses a strict 14-day creation cutoff", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const pullRequest = {
    createdAt: "2026-10-01T12:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    hasReviewed: false
  };

  assert.equal(isOldUnreviewedPullRequest(pullRequest, now), false);
  assert.equal(isOldUnreviewedPullRequest(pullRequest, now + 1), true);
  assert.equal(isOldUnreviewedPullRequest(pullRequest, now - 1), false);
  assert.equal(isOldUnreviewedPullRequest({
    ...pullRequest,
    hasReviewed: true
  }, now + 1), false);
  assert.equal(isOldUnreviewedPullRequest({
    ...pullRequest,
    hasReviewed: undefined
  }, now + 1), false);
  for (const createdAt of [undefined, "", "invalid", "2026-10-16T12:00:00Z"]) {
    assert.equal(isOldUnreviewedPullRequest({
      ...pullRequest,
      createdAt
    }, now), false);
  }
});

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

test("applyReviewDismissals keeps co-authored PRs out of popup actions", () => {
  const coAuthored = {
    title: "Automation-owned PR",
    url: "https://github.com/octo/web/pull/3",
    updatedAt: "2026-03-01T00:00:00Z"
  };
  const result = applyReviewDismissals({
    authored: [coAuthored],
    reviewRequested: [coAuthored],
    assigned: [coAuthored]
  }, new Set([coAuthored.url]));

  assert.deepEqual(result.authored, [coAuthored]);
  assert.deepEqual(result.reviewRequested, []);
  assert.deepEqual(result.assigned, []);
  assert.deepEqual([...result.activeDismissedUrls], []);
});
