import assert from "node:assert/strict";
import test from "node:test";

import {
  commitIncludesGitHubUser,
  getGitHubPullRequests,
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

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    }
  };
}
