import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyStaleTabs,
  shouldGroupTab
} from "../src/lib/tab-sync.js";

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
