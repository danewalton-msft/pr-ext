import assert from "node:assert/strict";
import test from "node:test";

import { classifyStaleTabs } from "../src/lib/tab-sync.js";

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
