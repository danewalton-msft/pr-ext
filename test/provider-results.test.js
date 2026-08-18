import assert from "node:assert/strict";
import test from "node:test";

import { mergeProviderResults } from "../src/lib/provider-results.js";

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
      reviewRequested: []
    },
    {
      displayName: "octocat",
      repositoryCount: 1,
      activePullRequestCount: 2,
      automationOwnedCount: 0,
      skippedRepositories: ["GitHub: octo/private"],
      authored: [shared],
      reviewRequested: [shared]
    }
  ]);

  assert.equal(result.displayName, "Ada · octocat");
  assert.equal(result.repositoryCount, 3);
  assert.equal(result.activePullRequestCount, 5);
  assert.equal(result.authored.length, 1);
  assert.equal(result.reviewRequested.length, 1);
});
