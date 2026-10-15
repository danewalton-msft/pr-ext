import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS } from "../src/lib/settings.js";

let importId = 0;

test("sync ungroups old unreviewed PRs without changing popup state", async (t) => {
  for (const staleTabAction of ["close", "complete", "ungroup"]) {
    await t.test(staleTabAction, async (t) => {
      const url = (number) =>
        `https://dev.azure.com/contoso/App/_git/Web/pullrequest/${number}`;
      const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();
      const pullRequest = (number, overrides = {}) => ({
        title: `PR ${number}`,
        pullRequestId: number,
        creationDate: old,
        createdBy: { id: "another-user" },
        reviewers: [{ id: "user-id", vote: 0 }],
        repository: {
          id: "Web",
          name: "Web",
          project: { id: "App", name: "App" }
        },
        ...overrides
      });
      const pullRequests = [
        pullRequest(1),
        pullRequest(2),
        pullRequest(3),
        pullRequest(4, { reviewers: [{ id: "user-id", vote: 10 }] }),
        pullRequest(5, {
          reviewers: [{ id: "user-id", vote: -5, isFlagged: true }]
        }),
        pullRequest(6, { createdBy: { id: "user-id" } }),
        pullRequest(7, { creationDate: recent }),
        pullRequest(8, { isDraft: true })
      ];
      const browser = await mockBackground(t, {
        pullRequests,
        settings: { staleTabAction },
        managedUrls: [1, 2, 3, 4, 5, 9].map(url),
        dismissedUrls: [url(2)],
        groups: [
          { id: 11, title: DEFAULT_SETTINGS.reviewGroupTitle },
          { id: 12, title: DEFAULT_SETTINGS.assignedGroupTitle },
          { id: 13, title: "✅ Complete" },
          { id: 14, title: "My own group" }
        ],
        tabs: [
          { id: 1, url: `${url(1)}?_a=files#discussion`, groupId: 11 },
          { id: 2, url: url(2), groupId: 12 },
          { id: 3, url: url(3), groupId: 13 },
          { id: 4, url: url(3), groupId: 14 },
          { id: 5, url: url(4), groupId: 12 },
          { id: 6, url: url(5), groupId: 11 },
          { id: 7, url: url(7), groupId: -1, splitViewId: 20 },
          { id: 8, url: "https://example.com/", groupId: 13 },
          { id: 9, url: url(9), groupId: 11 }
        ]
      });

      const result = await browser.sync();

      assert.equal(result.ok, true, result.error);
      assert.equal(result.authoredCount, 1);
      assert.equal(result.reviewCount, 4);
      assert.equal(result.assignedCount, 3);
      assert.deepEqual(new Set(result.actionableReviewUrls), new Set(
        [1, 3, 5, 7].map(url)
      ));
      assert.deepEqual(result.dismissedReviewUrls, [url(2)]);
      assert.equal(result.assignedItems.find((pr) => pr.url === url(2)).dismissed, true);
      assert.equal(result.assignedItems.some((pr) => pr.url === url(8)), true);
      assert.equal(browser.badge(), "4");
      for (const id of [1, 2, 3]) {
        assert.equal(browser.tabs.get(id).groupId, -1);
        assert.equal(browser.groupedIds.includes(id), false);
        assert.equal(browser.removedIds.includes(id), false);
      }
      assert.equal(browser.tabs.get(4).groupId, 14);
      assert.equal(browser.tabs.get(5).groupId, 12);
      assert.equal(browser.tabs.get(6).groupId, 11);
      assert.equal(browser.tabs.get(7).groupId, -1);
      assert.equal(browser.groupedIds.includes(7), false);
      assert.equal(browser.tabs.get(8).groupId, 13);
      assert.equal(browser.createdUrls.includes(url(8)), false);
      assert.equal(browser.createdUrls.includes(url(6)), true);
      assert.equal(browser.storage.managedPullRequestUrls.includes(url(1)), true);
      assert.equal(browser.storage.managedPullRequestUrls.includes(url(8)), true);
      if (staleTabAction === "close") {
        assert.deepEqual(browser.removedIds, [9]);
      } else if (staleTabAction === "complete") {
        assert.equal(browser.tabs.get(9).groupId, 13);
      } else {
        assert.equal(browser.tabs.get(9).groupId, -1);
      }

      pullRequests[0].reviewers[0].vote = 10;
      const reviewedResult = await browser.sync();

      assert.equal(reviewedResult.ok, true, reviewedResult.error);
      assert.equal(browser.tabs.get(1).groupId, 12);
      assert.equal(browser.createdUrls.includes(url(1)), false);
      assert.deepEqual(reviewedResult.dismissedReviewUrls, [url(2)]);
    });
  }
});

test("sync tolerates Edge removing groups emptied by age exclusion", async (t) => {
  const url = "https://dev.azure.com/contoso/App/_git/Web/pullrequest/1";
  const browser = await mockBackground(t, {
    pullRequests: [{
      title: "Old unreviewed PR",
      pullRequestId: 1,
      creationDate: "2020-01-01T00:00:00Z",
      createdBy: { id: "another-user" },
      reviewers: [{ id: "user-id", vote: 0 }],
      repository: {
        id: "Web",
        name: "Web",
        project: { id: "App", name: "App" }
      }
    }],
    managedUrls: [url],
    groups: [{ id: 11, title: DEFAULT_SETTINGS.reviewGroupTitle }],
    tabs: [{ id: 1, url, groupId: 11 }]
  });

  const result = await browser.sync();

  assert.equal(result.ok, true, result.error);
  assert.equal(result.reviewCount, 1);
  assert.equal(browser.tabs.get(1).groupId, -1);
  assert.equal(browser.groups.size, 0);
  assert.deepEqual(browser.createdUrls, []);
});

test("sync defers age-based ungrouping until a tab leaves split view", async (t) => {
  const url = "https://dev.azure.com/contoso/App/_git/Web/pullrequest/1";
  const browser = await mockBackground(t, {
    pullRequests: [{
      title: "Old unreviewed PR",
      pullRequestId: 1,
      creationDate: "2020-01-01T00:00:00Z",
      createdBy: { id: "another-user" },
      reviewers: [{ id: "user-id", vote: 0 }],
      repository: {
        id: "Web",
        name: "Web",
        project: { id: "App", name: "App" }
      }
    }],
    managedUrls: [url],
    groups: [{ id: 11, title: DEFAULT_SETTINGS.reviewGroupTitle }],
    tabs: [{ id: 1, url, groupId: 11, splitViewId: 20 }]
  });

  const first = await browser.sync();
  assert.equal(first.ok, true, first.error);
  assert.equal(browser.tabs.get(1).groupId, 11);
  assert.equal(browser.tabs.get(1).splitViewId, 20);

  browser.tabs.get(1).splitViewId = -1;
  const second = await browser.sync();
  assert.equal(second.ok, true, second.error);
  assert.equal(browser.tabs.get(1).groupId, -1);
  assert.equal(browser.groups.size, 0);
  assert.deepEqual(browser.groupedIds, []);
  assert.deepEqual(browser.removedIds, []);
});

async function mockBackground(t, {
  pullRequests,
  settings = {},
  managedUrls = [],
  dismissedUrls = [],
  groups = [],
  tabs = []
}) {
  const storage = {
    settings: {
      ...DEFAULT_SETTINGS,
      organization: "contoso",
      token: "test-token",
      repositories: "App/Web",
      ...settings
    },
    managedPullRequestUrls: managedUrls,
    dismissedReviewUrls: dismissedUrls
  };
  const groupsById = new Map(groups.map((group) => [
    group.id, { windowId: 1, ...group }
  ]));
  const tabsById = new Map(tabs.map((tab) => [
    tab.id, { windowId: 1, ...tab }
  ]));
  const createdUrls = [];
  const groupedIds = [];
  const removedIds = [];
  const previousChrome = globalThis.chrome;
  let onMessage;
  let badge;
  let nextTabId = 100;
  let nextGroupId = 100;
  const removeEmptyGroups = () => {
    for (const id of groupsById.keys()) {
      if (![...tabsById.values()].some(({ groupId }) => groupId === id)) {
        groupsById.delete(id);
      }
    }
  };
  const event = () => ({ addListener() {} });
  t.after(() => {
    if (previousChrome === undefined) {
      delete globalThis.chrome;
    } else {
      globalThis.chrome = previousChrome;
    }
  });
  t.mock.method(globalThis, "fetch", async (value) => {
    const requestUrl = new URL(value);
    assert.equal(requestUrl.origin, "https://dev.azure.com");
    const body = requestUrl.pathname.endsWith("/_apis/connectionData")
      ? { authorizedUser: { id: "user-id", displayName: "Test user" } }
      : { value: pullRequests };
    return {
      ok: true,
      headers: { get: () => null },
      async json() {
        return body;
      }
    };
  });
  globalThis.chrome = {
    runtime: {
      onInstalled: event(),
      onStartup: event(),
      onMessage: { addListener(listener) { onMessage = listener; } }
    },
    alarms: { onAlarm: event() },
    storage: {
      onChanged: event(),
      local: {
        async get(keys) {
          return Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[key]])
          );
        },
        async set(values) {
          Object.assign(storage, values);
        }
      }
    },
    windows: { async getLastFocused() { return { id: 1 }; } },
    action: {
      async setBadgeBackgroundColor() {},
      async setBadgeText({ text }) { badge = text; }
    },
    tabGroups: {
      async query(query) {
        return [...groupsById.values()].filter((group) =>
          Object.entries(query).every(([key, value]) => group[key] === value)
        );
      },
      async update(id, values) {
        assert.equal(groupsById.has(id), true, `Group ${id} no longer exists`);
        Object.assign(groupsById.get(id), values);
      }
    },
    tabs: {
      SPLIT_VIEW_ID_NONE: -1,
      async query(query) {
        return [...tabsById.values()].filter((tab) =>
          Object.entries(query).every(([key, value]) => tab[key] === value)
        ).map((tab) => ({ ...tab }));
      },
      async create({ url, windowId }) {
        const tab = { id: nextTabId++, url, windowId, groupId: -1 };
        tabsById.set(tab.id, tab);
        createdUrls.push(url);
        return { ...tab };
      },
      async group({ groupId, createProperties, tabIds }) {
        if (groupId === undefined) {
          groupId = nextGroupId++;
          groupsById.set(groupId, { id: groupId, ...createProperties });
        }
        assert.equal(groupsById.has(groupId), true);
        for (const id of tabIds) {
          tabsById.get(id).groupId = groupId;
          groupedIds.push(id);
        }
        removeEmptyGroups();
        return groupId;
      },
      async ungroup(tabIds) {
        for (const id of tabIds) {
          tabsById.get(id).groupId = -1;
        }
        removeEmptyGroups();
      },
      async remove(tabIds) {
        for (const id of tabIds) {
          tabsById.delete(id);
          removedIds.push(id);
        }
        removeEmptyGroups();
      }
    }
  };
  await import(`../src/background.js?test=${importId++}`);
  return {
    storage,
    groups: groupsById,
    tabs: tabsById,
    createdUrls,
    groupedIds,
    removedIds,
    badge: () => badge,
    sync: () => new Promise((resolve) => {
      assert.equal(onMessage({ type: "sync" }, {}, resolve), true);
    })
  };
}
