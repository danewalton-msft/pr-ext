import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStaleTabs,
  excludedManagedTabIds,
  filterTabGroupPullRequests,
  shouldGroupTab
} from "../src/lib/tab-sync.js";
import { applyReviewDismissals } from "../src/lib/provider-results.js";

test("filterTabGroupPullRequests excludes only old unreviewed non-owned PRs", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  const old = {
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    hasReviewed: false
  };
  const authored = { ...old, url: "owned" };
  const review = { ...old, url: "review" };
  const assigned = { ...old, url: "assigned" };
  const reviewed = { ...old, url: "reviewed", hasReviewed: true };
  const young = { ...old, url: "young", createdAt: "2026-10-10T00:00:00Z" };
  const boundary = { ...old, url: "boundary", createdAt: "2026-10-01T12:00:00Z" };
  const unknown = { ...old, url: "unknown", hasReviewed: undefined };
  const pullRequests = {
    authored: [authored],
    reviewRequested: [review, reviewed, young, boundary, unknown, authored],
    assigned: [assigned, reviewed, young, boundary, unknown, authored]
  };
  const result = filterTabGroupPullRequests(pullRequests, now);

  assert.deepEqual(result.authored, [authored]);
  assert.deepEqual(
    result.reviewRequested,
    [reviewed, young, boundary, unknown, authored]
  );
  assert.deepEqual(
    result.assigned,
    [reviewed, young, boundary, unknown, authored]
  );
  assert.deepEqual([...result.excludedUrls], ["review", "assigned"]);
  assert.equal(pullRequests.reviewRequested.length, 6);
  assert.equal(pullRequests.assigned.length, 6);
});

test("age exclusion preserves manual dismissals and popup classification", () => {
  const review = {
    url: "review",
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-10-15T12:00:00Z",
    hasReviewed: false
  };
  const pullRequests = {
    authored: [],
    reviewRequested: [review],
    assigned: []
  };
  const dismissed = applyReviewDismissals(pullRequests, new Set([review.url]));
  const restored = applyReviewDismissals(pullRequests, new Set());
  const now = Date.parse("2026-10-15T12:00:00Z");

  assert.deepEqual(filterTabGroupPullRequests(dismissed, now).assigned, []);
  assert.deepEqual(filterTabGroupPullRequests(restored, now).reviewRequested, []);
  assert.deepEqual(dismissed.assigned, [review]);
  assert.deepEqual([...dismissed.activeDismissedUrls], [review.url]);
  assert.deepEqual(restored.reviewRequested, [review]);
});

test("excludedManagedTabIds selects only previously managed excluded URLs", () => {
  const url = "https://github.com/octo/web/pull/1";
  const unmanaged = "https://github.com/octo/web/pull/2";
  const current = "https://github.com/octo/web/pull/3";

  assert.deepEqual(excludedManagedTabIds([
    { id: 1, url: `${url}/?tab=files#discussion` },
    { id: 2, url: unmanaged },
    { id: 3, url: current },
    { id: 4, url: "https://example.com/" },
    { id: 5, url: "invalid" },
    { id: 6 },
    { id: 7, url, splitViewId: 20 }
  ], new Set([url, current]), new Set([url, unmanaged])), [1]);
});

test("excluded tabs stay in split view until Edge releases the split", () => {
  const url = "https://github.com/octo/web/pull/1";
  const tabs = [{ id: 1, url, splitViewId: 20 }];

  assert.deepEqual(excludedManagedTabIds(
    tabs, new Set([url]), new Set([url])
  ), []);
  assert.deepEqual(classifyStaleTabs(
    tabs, new Set(), new Set(), "close"
  ), { closeTabIds: [], completeTabIds: [], ungroupTabIds: [] });
  tabs[0].splitViewId = -1;
  assert.deepEqual(excludedManagedTabIds(
    tabs, new Set([url]), new Set([url])
  ), [1]);
  assert.deepEqual(classifyStaleTabs(
    tabs, new Set(), new Set(), "complete"
  ), { closeTabIds: [], completeTabIds: [], ungroupTabIds: [1] });
});

test("shouldGroupTab avoids disrupting tabs already grouped or in split view", () => {
  assert.equal(shouldGroupTab({ groupId: 7 }, 7), false);
  assert.equal(
    shouldGroupTab({ groupId: -1, splitViewId: 12 }, 7, -1),
    false
  );
  assert.equal(
    shouldGroupTab({ groupId: -1, splitViewId: -1 }, 7, -1),
    true
  );
  assert.equal(shouldGroupTab({ groupId: -1 }, 7, -1), true);
});

test("classifyStaleTabs closes only previously managed stale PR tabs", () => {
  const staleUrl = "https://dev.azure.com/contoso/app/_git/web/pullrequest/1";
  const result = classifyStaleTabs(
    [
      { id: 1, url: staleUrl },
      { id: 2, url: "https://example.com/" },
      { id: 3, url: "https://dev.azure.com/contoso/app/_git/web/pullrequest/2" }
    ],
    new Set([3]),
    new Set([staleUrl]),
    "close"
  );

  assert.deepEqual(result, {
    closeTabIds: [1],
    completeTabIds: [],
    ungroupTabIds: [2]
  });
});

test("classifyStaleTabs only ungroups stale tabs when closing is disabled", () => {
  const staleUrl = "https://dev.azure.com/contoso/app/_git/web/pullrequest/1";
  const result = classifyStaleTabs(
    [{ id: 1, url: staleUrl }],
    new Set(),
    new Set([staleUrl]),
    "ungroup"
  );

  assert.deepEqual(result, {
    closeTabIds: [],
    completeTabIds: [],
    ungroupTabIds: [1]
  });
});

test("classifyStaleTabs moves managed stale tabs to complete", () => {
  const staleUrl = "https://dev.azure.com/contoso/app/_git/web/pullrequest/1";
  const result = classifyStaleTabs(
    [{ id: 1, url: staleUrl }],
    new Set(),
    new Set([staleUrl]),
    "complete"
  );

  assert.deepEqual(result, {
    closeTabIds: [],
    completeTabIds: [1],
    ungroupTabIds: []
  });
});
