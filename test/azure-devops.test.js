import assert from "node:assert/strict";
import test from "node:test";

import {
  AzureDevOpsApiError,
  canonicalPullRequestUrl,
  commitIncludesIdentity,
  getPullRequests,
  hasUserReviewed,
  isAssignedReviewer,
  isAutomationPullRequest,
  needsUserReview,
  normalizeOrganization,
  normalizePullRequests,
  parseRepositoryFilters,
  sameIdentity
} from "../src/lib/azure-devops.js";
import { applyReviewDismissals } from "../src/lib/provider-results.js";
import { filterTabGroupPullRequests } from "../src/lib/tab-sync.js";

test("normalizeOrganization accepts a name or dev.azure.com URL", () => {
  assert.equal(normalizeOrganization("contoso"), "contoso");
  assert.equal(normalizeOrganization("https://dev.azure.com/contoso/"), "contoso");
});

test("parseRepositoryFilters accepts names and URLs and removes duplicates", () => {
  assert.deepEqual(
    parseRepositoryFilters(
      "App/Web\nhttps://dev.azure.com/contoso/App/_git/API\napp/web",
      "contoso"
    ),
    [
      {
        id: "web",
        name: "web",
        project: { id: "app", name: "app" }
      },
      {
        id: "API",
        name: "API",
        project: { id: "App", name: "App" }
      }
    ]
  );
});

test("canonicalPullRequestUrl removes query, fragment, and trailing slash", () => {
  assert.equal(
    canonicalPullRequestUrl(
      "https://dev.azure.com/contoso/app/_git/web/pullrequest/42/?_a=files#discussion"
    ),
    "https://dev.azure.com/contoso/app/_git/web/pullrequest/42"
  );
});

test("needsUserReview includes neutral or flagged reviewers and excludes drafts", () => {
  const pullRequest = {
    isDraft: false,
    reviewers: [{ id: "USER-ID", vote: 0, isFlagged: false }]
  };

  assert.equal(needsUserReview(pullRequest, "user-id"), true);
  assert.equal(needsUserReview({ ...pullRequest, isDraft: true }, "user-id"), false);
  assert.equal(
    needsUserReview({
      ...pullRequest,
      reviewers: [{ id: "user-id", vote: 10, isFlagged: false }]
    }, "user-id"),
    false
  );
  assert.equal(
    needsUserReview({
      ...pullRequest,
      reviewers: [{ id: "user-id", vote: 10, isFlagged: true }]
    }, "user-id"),
    true
  );
  assert.equal(
    needsUserReview({
      ...pullRequest,
      reviewers: [{
        id: "team-id",
        vote: 0,
        votedFor: [{ id: "user-id", vote: 0, isFlagged: false }]
      }]
    }, "user-id"),
    true
  );
});

test("isAssignedReviewer includes reviewers who already voted", () => {
  const pullRequest = {
    reviewers: [{ id: "user-id", vote: 10, isFlagged: false }]
  };

  assert.equal(isAssignedReviewer(pullRequest, "user-id"), true);
  assert.equal(needsUserReview(pullRequest, "user-id"), false);
});

test("hasUserReviewed requires a nonzero vote from the current user", () => {
  for (const vote of [-10, -5, 5, 10]) {
    assert.equal(hasUserReviewed({
      reviewers: [{ id: "USER-ID", vote, isFlagged: true }]
    }, "user-id"), true);
  }
  for (const vote of [0, undefined, null, "10"]) {
    assert.equal(hasUserReviewed({
      reviewers: [{ id: "user-id", vote }]
    }, "user-id"), false);
  }
  assert.equal(hasUserReviewed({
    reviewers: [{ id: "other-user", vote: 10 }]
  }, "user-id"), false);
  assert.equal(hasUserReviewed({}, "user-id"), false);
  assert.equal(hasUserReviewed({
    reviewers: [{
      id: "team-id",
      vote: 10,
      votedFor: [{ id: "user-id", vote: 0 }]
    }]
  }, "user-id"), false);
  assert.equal(hasUserReviewed({
    reviewers: [{
      id: "team-id",
      vote: 0,
      votedFor: [{ uniqueName: "ADA@example.com", vote: -5 }]
    }]
  }, [{ uniqueName: "ada@example.com" }]), true);
});

test("hasUserReviewed recognizes historical votes after the current vote resets", () => {
  const pullRequest = {
    reviewers: [{ id: "user-id", vote: 0 }]
  };
  for (const vote of [-10, -5, 5, 10]) {
    const threads = [
      voteThread("USER-ID", String(vote)),
      voteThread("user-id", "0")
    ];
    assert.equal(hasUserReviewed(pullRequest, "user-id", threads), true);
    assert.equal(hasUserReviewed(
      pullRequest, [{ id: "user-id" }], threads
    ), true);
    assert.equal(needsUserReview(pullRequest, "user-id"), true);
  }
  assert.equal(hasUserReviewed(pullRequest, "user-id", [{
    properties: {
      CodeReviewThreadType: "VoteUpdate",
      CodeReviewVotedByTfId: "user-id",
      CodeReviewVoteResult: 10
    }
  }]), true);
});

test("historical review detection ignores resets, other voters and unrelated activity", () => {
  const pullRequest = {
    reviewers: [{ id: "user-id", vote: 0 }]
  };
  const otherUser = voteThread("other-user", "10");
  otherUser.properties.CodeReviewVotedByDisplayName = { $value: "Ada" };
  otherUser.comments = [{ author: { id: "user-id" } }];
  const deleted = { ...voteThread("user-id", "10"), isDeleted: true };
  const unrelated = voteThread("user-id", "10");
  unrelated.properties.CodeReviewThreadType.$value = "ReviewersUpdate";
  const missingVoter = voteThread(undefined, "10");
  for (const thread of [
    ...[0, "", null, undefined, "invalid", "1", true].map(
      (vote) => voteThread("user-id", vote)
    ),
    otherUser,
    deleted,
    unrelated,
    missingVoter,
    { comments: [{ author: { id: "user-id" }, content: "Approved" }] },
    {}
  ]) {
    assert.equal(hasUserReviewed(
      pullRequest,
      [{ id: "user-id", displayName: "Ada" }],
      [thread]
    ), false);
  }
});

test("sameIdentity matches Azure DevOps identity IDs or descriptors", () => {
  assert.equal(
    sameIdentity({ id: "USER-ID" }, { id: "user-id" }),
    true
  );
  assert.equal(
    sameIdentity({ descriptor: "aad.user" }, { descriptor: "aad.user" }),
    true
  );
  assert.equal(
    sameIdentity(
      { uniqueName: "Ada@Example.com" },
      { uniqueName: "ada@example.com" }
    ),
    true
  );
  assert.equal(
    sameIdentity(
      {
        providerDisplayName: "Ada Lovelace",
        properties: {
          Account: { $value: "ada@example.com" }
        }
      },
      { displayName: "Ada Lovelace", uniqueName: "ada@example.com" }
    ),
    true
  );
  assert.equal(sameIdentity({ id: "one" }, { id: "two" }), false);
});

test("automation ownership matches configured creators and co-author trailers", () => {
  assert.equal(
    isAutomationPullRequest(
      { createdBy: { displayName: "GitHub Copilot" } },
      "Agency\nGitHub Copilot"
    ),
    true
  );
  assert.equal(
    commitIncludesIdentity(
      {
        author: { name: "Bot", email: "bot@example.com" },
        comment: "Change code\n\nCo-authored-by: Ada Lovelace <ada@example.com>"
      },
      [{ uniqueName: "ada@example.com" }]
    ),
    true
  );
});

test("normalizePullRequests deduplicates and sorts by creation date", () => {
  const repository = {
    name: "web",
    webUrl: "https://dev.azure.com/contoso/app/_git/web",
    project: { name: "app" }
  };
  const result = normalizePullRequests([
    {
      title: "Older",
      pullRequestId: 1,
      repository,
      creationDate: "2026-01-01T00:00:00Z"
    },
    {
      title: "Newer",
      pullRequestId: 2,
      repository,
      creationDate: "2026-02-01T00:00:00Z"
    },
    {
      title: "Duplicate",
      pullRequestId: 2,
      repository,
      creationDate: "2026-02-01T00:00:00Z"
    }
  ], "contoso");

  assert.deepEqual(result.map(({ number }) => number), [2, 1]);
  assert.equal(result[0].createdAt, "2026-02-01T00:00:00Z");
});

test("normalizePullRequests builds a web URL when Azure omits repository.webUrl", () => {
  const [pullRequest] = normalizePullRequests([{
    title: "PR",
    pullRequestId: 42,
    creationDate: "2026-01-01T00:00:00Z",
    repository: {
      name: "Web API",
      project: { name: "Customer App" }
    }
  }], "contoso");

  assert.equal(
    pullRequest.url,
    "https://dev.azure.com/contoso/Customer%20App/_git/Web%20API/pullrequest/42"
  );
});

test("getPullRequests queries active PRs in every repository and classifies them", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);

    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({
        authenticatedUser: {
          id: "tenant-user-id",
          displayName: "Ada Tenant",
          uniqueName: "ada@example.com"
        },
        authorizedUser: {
          id: "user-id",
          displayName: "Ada Lovelace",
          uniqueName: "ada@example.com"
        }
      });
    }
    if (url.includes("/_apis/projects")) {
      return jsonResponse({ value: [{ id: "project-id" }] });
    }
    if (url.endsWith("/_apis/git/repositories?api-version=7.1")) {
      return jsonResponse({
        value: [
          {
            id: "inaccessible-id",
            name: "private",
            webUrl: "https://dev.azure.com/contoso/app/_git/private",
            project: { id: "project-id", name: "app" }
          },
          {
            id: "repository-id",
            name: "web",
            webUrl: "https://dev.azure.com/contoso/app/_git/web",
            project: { id: "project-id", name: "app" }
          },
          {
            id: "disabled-id",
            name: "old",
            isDisabled: true,
            webUrl: "https://dev.azure.com/contoso/app/_git/old",
            project: { id: "project-id", name: "app" }
          }
        ]
      });
    }
    if (url.includes("/repositories/inaccessible-id/pullrequests")) {
      return jsonResponse({
        message: "TF401019: The Git repository does not exist or you do not have permissions."
      }, 404);
    }
    return jsonResponse({
      value: [{
        title: "My PR",
        pullRequestId: 42,
        creationDate: "2026-01-01T00:00:00Z",
        createdBy: { id: "user-id" },
        reviewers: [{ id: "user-id", vote: 0 }],
        repository: {
          id: "repository-id",
          name: "web",
          webUrl: "https://dev.azure.com/contoso/app/_git/web",
          project: { id: "project-id", name: "app" }
        }
      }]
    });
  };

  const result = await getPullRequests("contoso", "token", "", fetchImpl);

  assert.equal(result.displayName, "Ada Lovelace");
  assert.equal(urls.length, 5);
  assert.equal(result.projectCount, 1);
  assert.equal(result.repositoryCount, 2);
  assert.deepEqual(result.skippedRepositories, ["app/private"]);
  assert.equal(result.activePullRequestCount, 1);
  assert.equal(result.authored.length, 1);
  assert.equal(result.authored[0].createdAt, "2026-01-01T00:00:00Z");
  assert.equal(result.reviewRequested[0].hasReviewed, undefined);
  assert.equal(result.automationOwnedCount, 0);
  assert.equal(result.reviewRequested.length, 1);
  assert.equal(result.assigned.length, 0);
  assert.ok(
    urls.some((url) =>
      url.includes("/_apis/connectionData") &&
      url.includes("api-version=7.1-preview")
    )
  );
  assert.ok(
    urls.some((url) =>
      url.includes("/_apis/git/repositories/repository-id/pullrequests") &&
      url.includes("searchCriteria.status=active")
    )
  );
});

test("getPullRequests bypasses discovery when repositories are configured", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({
        authenticatedUser: { id: "user-id", displayName: "Ada Lovelace" },
        authorizedUser: { id: "user-id", displayName: "Ada Lovelace" }
      });
    }
    return jsonResponse({ value: [] });
  };

  const result = await getPullRequests(
    "contoso",
    "token",
    "App/Web\nServices/API",
    "",
    fetchImpl
  );

  assert.equal(result.repositoryFilterActive, true);
  assert.equal(result.projectCount, 2);
  assert.equal(result.repositoryCount, 2);
  assert.equal(urls.length, 3);
  assert.equal(urls.some((url) => url.includes("/_apis/projects")), false);
  assert.equal(
    urls.some((url) => url.includes("/App/_apis/git/repositories/Web/pullrequests")),
    true
  );
});

test("getPullRequests keeps co-authored automation PRs in authored results", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({
        authorizedUser: {
          id: "user-id",
          providerDisplayName: "Ada Lovelace",
          properties: {
            Account: { $value: "ada@example.com" }
          }
        }
      });
    }
    if (url.includes("/pullRequests/42/commits")) {
      return jsonResponse({
        value: [{
          author: { name: "Agency", email: "agency@example.com" },
          comment: "Implement feature\n\nCo-authored-by: Ada Lovelace <ada@example.com>"
        }]
      });
    }
    return jsonResponse({
      value: [{
        title: "Automated PR",
        pullRequestId: 42,
        creationDate: "2026-01-01T00:00:00Z",
        createdBy: { displayName: "Agency" },
        reviewers: [{ id: "user-id", vote: 10 }],
        repository: {
          id: "Web",
          name: "Web",
          project: { id: "App", name: "App" }
        }
      }]
    });
  };

  const result = await getPullRequests(
    "contoso",
    "token",
    "App/Web",
    "Agency\nGitHub Copilot",
    fetchImpl
  );

  assert.equal(result.automationOwnedCount, 1);
  assert.equal(result.authored.length, 1);
  assert.equal(result.reviewRequested.length, 0);
  assert.equal(result.assigned.length, 1);
  assert.equal(result.assigned[0].hasReviewed, true);
});

test("Azure checks vote history only for older non-owned unreviewed assignments", async () => {
  const urls = [];
  const repository = {
    id: "repository-id",
    name: "Web",
    project: { id: "project-id", name: "App" }
  };
  const old = "2020-01-01T00:00:00Z";
  const pullRequest = (number, overrides = {}) => ({
    title: `PR ${number}`,
    pullRequestId: number,
    creationDate: old,
    createdBy: { id: "another-user" },
    reviewers: [{ id: "user-id", vote: 0 }],
    repository,
    ...overrides
  });
  const pullRequests = [
    pullRequest(1),
    pullRequest(2),
    pullRequest(3, { creationDate: new Date().toISOString() }),
    pullRequest(4, { reviewers: [{ id: "user-id", vote: 10 }] }),
    pullRequest(5, { createdBy: { id: "user-id" } }),
    pullRequest(6, { createdBy: { displayName: "Agency" } }),
    pullRequest(7, { reviewers: [{ id: "another-user", vote: 0 }] }),
    pullRequest(8, { isDraft: true }),
    pullRequest(9, {
      reviewers: [{ id: "user-id", vote: 5, isFlagged: true }]
    }),
    pullRequest(10, {
      reviewers: [{
        id: "team-id",
        vote: 0,
        votedFor: [{ id: "user-id", vote: 0 }]
      }]
    }),
    pullRequest(11)
  ];
  const threads = new Map([
    [1, [voteThread("user-id", "10"), voteThread("user-id", "0")]],
    [2, [voteThread("another-user", "10")]],
    [8, [voteThread("user-id", "-5")]],
    [10, [voteThread("user-id", "5")]],
    [11, [voteThread("user-id", "0")]]
  ]);
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({ authorizedUser: { id: "user-id" } });
    }
    if (url.includes("/pullRequests/6/commits")) {
      return jsonResponse({
        value: [{ author: { id: "user-id" } }]
      });
    }
    const threadMatch = new URL(url).pathname.match(/\/pullRequests\/(\d+)\/threads$/);
    if (threadMatch) {
      assert.equal(new URL(url).searchParams.get("api-version"), "7.1");
      assert.ok(url.includes("/project-id/_apis/git/repositories/repository-id/"));
      assert.equal(threads.has(Number(threadMatch[1])), true);
      return jsonResponse({ value: threads.get(Number(threadMatch[1])) });
    }
    assert.ok(new URL(url).pathname.endsWith("/pullrequests"));
    return jsonResponse({ value: pullRequests });
  };

  const result = await getPullRequests(
    "contoso", "token", "App/Web", "Agency", fetchImpl
  );
  const requested = new Map(result.reviewRequested.map((pr) => [pr.number, pr]));
  const assigned = new Map(result.assigned.map((pr) => [pr.number, pr]));
  assert.equal(requested.get(1).hasReviewed, true);
  assert.equal(requested.get(2).hasReviewed, false);
  assert.equal(requested.get(3).hasReviewed, undefined);
  assert.equal(assigned.get(4).hasReviewed, true);
  assert.equal(assigned.get(8).hasReviewed, true);
  assert.equal(requested.get(9).hasReviewed, true);
  assert.equal(requested.get(10).hasReviewed, true);
  assert.equal(requested.get(11).hasReviewed, false);
  assert.deepEqual(result.authored.map(({ number }) => number), [5, 6]);
  assert.equal(urls.filter((url) => url.includes("/threads?")).length, 5);

  const grouped = filterTabGroupPullRequests(applyReviewDismissals(result, new Set()));
  assert.deepEqual(grouped.reviewRequested.map(({ number }) => number), [3, 1, 9, 10]);
  assert.deepEqual(grouped.assigned.map(({ number }) => number), [4, 8]);
  assert.deepEqual(grouped.authored.map(({ number }) => number), [5, 6]);
});

test("Azure vote-history failures are reported rather than hiding reviewed PRs", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({ authorizedUser: { id: "user-id" } });
    }
    if (url.includes("/threads?")) {
      return jsonResponse({ message: "Access denied" }, 403);
    }
    return jsonResponse({ value: [{
      title: "Old PR",
      pullRequestId: 1,
      creationDate: "2020-01-01T00:00:00Z",
      createdBy: { id: "another-user" },
      reviewers: [{ id: "user-id", vote: 0 }],
      repository: {
        id: "repository-id",
        name: "Web",
        project: { id: "project-id", name: "App" }
      }
    }] });
  };

  await assert.rejects(
    getPullRequests("contoso", "token", "App/Web", "", fetchImpl),
    (error) => error instanceof AzureDevOpsApiError && error.status === 403
  );
});

test("a PR crossing the age cutoff stays visible until its history is checked", async (t) => {
  let now = Date.parse("2026-10-15T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);
    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({ authorizedUser: { id: "user-id" } });
    }
    if (url.includes("/threads?")) {
      return jsonResponse({ value: [voteThread("user-id", "10")] });
    }
    return jsonResponse({ value: [{
      title: "PR at the age cutoff",
      pullRequestId: 1,
      creationDate: "2026-10-01T12:00:00Z",
      createdBy: { id: "another-user" },
      reviewers: [{ id: "user-id", vote: 0 }],
      repository: {
        id: "repository-id",
        name: "Web",
        project: { id: "project-id", name: "App" }
      }
    }] });
  };

  const first = await getPullRequests("contoso", "token", "App/Web", "", fetchImpl);
  assert.equal(urls.some((url) => url.includes("/threads?")), false);
  now += 1;
  assert.equal(filterTabGroupPullRequests(first).reviewRequested.length, 1);

  const second = await getPullRequests("contoso", "token", "App/Web", "", fetchImpl);
  assert.equal(urls.filter((url) => url.includes("/threads?")).length, 1);
  assert.equal(second.reviewRequested[0].hasReviewed, true);
  assert.equal(filterTabGroupPullRequests(second).reviewRequested.length, 1);
});

function voteThread(voterId, vote) {
  return {
    comments: [{ author: { id: "service-account-id" }, commentType: "system" }],
    properties: {
      CodeReviewThreadType: { $type: "System.String", $value: "VoteUpdate" },
      CodeReviewVotedByTfId: { $type: "System.String", $value: voterId },
      CodeReviewVoteResult: { $type: "System.String", $value: vote }
    },
    isDeleted: false
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    async json() {
      return body;
    }
  };
}
