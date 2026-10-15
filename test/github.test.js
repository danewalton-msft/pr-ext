import assert from "node:assert/strict";
import test from "node:test";

import { applyReviewDismissals } from "../src/lib/provider-results.js";
import { filterTabGroupPullRequests } from "../src/lib/tab-sync.js";
import {
  commitIncludesGitHubUser,
  getGitHubPullRequests,
  GitHubApiError,
  isGitHubAutomationPullRequest,
  parseGitHubRepositoryFilters
} from "../src/lib/github.js";

test("parseGitHubRepositoryFilters accepts names and URLs", () => {
  assert.deepEqual(
    parseGitHubRepositoryFilters(
      "octo/web\nhttps://github.com/octo/api.git\nocto/web"
    ),
    [
      { fullName: "octo/web" },
      { fullName: "octo/api" }
    ]
  );
});

test("GitHub automation and co-author matching handles bot names and noreply email", () => {
  assert.equal(
    isGitHubAutomationPullRequest(
      { user: { login: "github-copilot[bot]" } },
      "GitHub Copilot"
    ),
    true
  );
  assert.equal(
    commitIncludesGitHubUser(
      {
        commit: {
          message: "Change\n\nCo-authored-by: Octo Cat <1+octocat@users.noreply.github.com>"
        }
      },
      { id: 1, login: "octocat", name: "Octo Cat", email: null }
    ),
    true
  );
});

test("getGitHubPullRequests classifies authored, review, and automation-owned PRs", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/user")) {
      return jsonResponse({
        id: 1,
        login: "octocat",
        name: "Octo Cat",
        email: null
      });
    }
    if (url.includes("/pulls/2/commits")) {
      return jsonResponse([{
        commit: {
          message: "Automated\n\nCo-authored-by: Octo Cat <1+octocat@users.noreply.github.com>"
        }
      }]);
    }
    if (url.includes("/search/issues")) {
      return jsonResponse({
        items: [{
          title: "Needs review",
          html_url: "https://github.com/octo/web/pull/3",
          number: 3,
          updated_at: "2026-03-01T00:00:00Z"
        }]
      });
    }
    return jsonResponse([
      {
        title: "Mine",
        html_url: "https://github.com/octo/web/pull/1",
        number: 1,
        updated_at: "2026-01-01T00:00:00Z",
        user: { login: "octocat" },
        assignees: [],
        base: { repo: { full_name: "octo/web" } }
      },
      {
        title: "Automated",
        html_url: "https://github.com/octo/web/pull/2",
        number: 2,
        updated_at: "2026-02-01T00:00:00Z",
        user: { login: "github-copilot[bot]" },
        assignees: [{ login: "octocat" }],
        base: { repo: { full_name: "octo/web" } }
      }
    ]);
  };

  const result = await getGitHubPullRequests(
    "token",
    "https://github.com/octo/web",
    "GitHub Copilot",
    fetchImpl
  );

  assert.equal(result.repositoryCount, 1);
  assert.equal(result.activePullRequestCount, 2);
  assert.equal(result.automationOwnedCount, 1);
  assert.deepEqual(result.authored.map(({ number }) => number), [2, 1]);
  assert.deepEqual(result.reviewRequested.map(({ number }) => number), [3]);
  assert.deepEqual(result.assigned.map(({ number }) => number), [2]);
});

test("GitHub checks older candidates once and paginates their review history", async () => {
  const urls = [];
  const old = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date().toISOString();
  const pullRequest = (number, overrides = {}) => ({
    title: `PR ${number}`,
    html_url: `https://github.com/octo/web/pull/${number}`,
    number,
    created_at: old,
    updated_at: recent,
    user: { login: "another-user" },
    assignees: [{ login: "octocat" }],
    base: { repo: { full_name: "octo/web" } },
    ...overrides
  });
  const openPulls = [
    pullRequest(1),
    pullRequest(2),
    pullRequest(3, { created_at: recent }),
    pullRequest(4, { user: { login: "octocat" } }),
    pullRequest(5, { user: { login: "github-copilot[bot]" } }),
    pullRequest(6, { assignees: [] }),
    pullRequest(7, { assignees: [] })
  ];
  const fetchImpl = async (url) => {
    urls.push(url);
    const path = new URL(url).pathname;
    if (path === "/user") {
      return jsonResponse({ login: "octocat" });
    }
    if (path.endsWith("/pulls/5/commits")) {
      return jsonResponse([{ author: { login: "octocat" } }]);
    }
    if (path === "/search/issues") {
      return jsonResponse({
        items: openPulls.filter(({ number }) => [1, 2, 7].includes(number)),
        total_count: 3
      });
    }
    if (path.endsWith("/pulls/1/reviews")) {
      return jsonResponse(new URL(url).searchParams.get("page") === "1"
        ? Array.from({ length: 100 }, () => ({
          user: { login: "another-user" },
          state: "APPROVED"
        }))
        : [{ user: { login: "OCTOCAT" }, state: "COMMENTED" }]);
    }
    if (path.endsWith("/pulls/2/reviews")) {
      return jsonResponse([{ user: { login: "octocat" }, state: "PENDING" }]);
    }
    if (path.endsWith("/pulls/7/reviews")) {
      return jsonResponse([{ user: { login: "octocat" }, state: "DISMISSED" }]);
    }
    assert.equal(path, "/repos/octo/web/pulls");
    return jsonResponse(openPulls);
  };
  const result = await getGitHubPullRequests(
    "token", "octo/web", "GitHub Copilot", fetchImpl
  );
  const requested = new Map(
    result.reviewRequested.map((pr) => [pr.number, pr])
  );
  const assigned = new Map(result.assigned.map((pr) => [pr.number, pr]));

  assert.equal(requested.get(1).createdAt, old);
  assert.equal(requested.get(1).updatedAt, recent);
  assert.equal(requested.get(1).hasReviewed, true);
  assert.equal(assigned.get(1).hasReviewed, true);
  assert.equal(requested.get(2).hasReviewed, false);
  assert.equal(assigned.get(2).hasReviewed, false);
  assert.equal(requested.get(7).hasReviewed, true);
  assert.equal(assigned.get(3).hasReviewed, undefined);
  assert.deepEqual(result.authored.map(({ number }) => number), [4, 5]);
  assert.deepEqual(urls.filter((url) => url.includes("/reviews?")).map(
    (url) => new URL(url).pathname
  ).sort(), [
    "/repos/octo/web/pulls/1/reviews",
    "/repos/octo/web/pulls/1/reviews",
    "/repos/octo/web/pulls/2/reviews",
    "/repos/octo/web/pulls/7/reviews"
  ]);
  const popup = applyReviewDismissals(result, new Set());
  const grouped = filterTabGroupPullRequests(popup);
  assert.deepEqual(grouped.authored.map(({ number }) => number), [4, 5]);
  assert.deepEqual(grouped.reviewRequested.map(({ number }) => number), [1, 7]);
  assert.deepEqual(grouped.assigned.map(({ number }) => number), [3]);
  assert.deepEqual([...grouped.excludedUrls], [
    "https://github.com/octo/web/pull/2"
  ]);
  assert.deepEqual(popup.reviewRequested.map(({ number }) => number), [1, 2, 7]);
});

test("GitHub distinguishes submitted reviews from pending or other-user reviews", async (t) => {
  for (const [reviews, expected] of [
    [[], false],
    [[{ user: { login: "octocat" }, state: "APPROVED" }], true],
    [[{ user: { login: "octocat" }, state: "CHANGES_REQUESTED" }], true],
    [[{ user: { login: "octocat" }, state: "COMMENTED" }], true],
    [[{ user: { login: "octocat" }, state: "DISMISSED" }], true],
    [[{ user: { login: "octocat" }, state: "PENDING" }], false],
    [[{ user: { login: "another-user" }, state: "APPROVED" }], false],
    [[{ user: null, state: "APPROVED" }], false]
  ]) {
    await t.test(JSON.stringify(reviews), async () => {
      const fetchImpl = async (url) => {
        if (url.endsWith("/user")) {
          return jsonResponse({ login: "octocat" });
        }
        if (url.includes("/reviews?")) {
          return jsonResponse(reviews);
        }
        if (url.includes("/search/issues")) {
          return jsonResponse({ items: [] });
        }
        return jsonResponse([{
          title: "Assigned PR",
          html_url: "https://github.com/octo/web/pull/1",
          number: 1,
          created_at: "2020-01-01T00:00:00Z",
          updated_at: new Date().toISOString(),
          user: { login: "another-user" },
          assignees: [{ login: "octocat" }]
        }]);
      };
      const result = await getGitHubPullRequests("token", "octo/web", "", fetchImpl);
      assert.equal(result.assigned[0].hasReviewed, expected);
    });
  }
});

test("GitHub review-history failures are reported instead of hiding PRs", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/user")) {
      return jsonResponse({ login: "octocat" });
    }
    if (url.includes("/reviews?")) {
      return jsonResponse({ message: "Access denied" }, 403);
    }
    if (url.includes("/search/issues")) {
      return jsonResponse({ items: [] });
    }
    return jsonResponse([{
      title: "Assigned PR",
      html_url: "https://github.com/octo/web/pull/1",
      number: 1,
      created_at: "2020-01-01T00:00:00Z",
      updated_at: new Date().toISOString(),
      user: { login: "another-user" },
      assignees: [{ login: "octocat" }]
    }]);
  };

  await assert.rejects(
    getGitHubPullRequests("token", "octo/web", "", fetchImpl),
    (error) => error instanceof GitHubApiError && error.status === 403
  );
});

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}
