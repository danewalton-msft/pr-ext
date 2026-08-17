import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalPullRequestUrl,
  getPullRequests,
  needsUserReview,
  normalizeOrganization,
  normalizePullRequests,
  sameIdentity
} from "../src/lib/azure-devops.js";

test("normalizeOrganization accepts a name or dev.azure.com URL", () => {
  assert.equal(normalizeOrganization("contoso"), "contoso");
  assert.equal(normalizeOrganization("https://dev.azure.com/contoso/"), "contoso");
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

test("sameIdentity matches Azure DevOps identity IDs or descriptors", () => {
  assert.equal(
    sameIdentity({ id: "USER-ID" }, { id: "user-id" }),
    true
  );
  assert.equal(
    sameIdentity({ descriptor: "aad.user" }, { descriptor: "aad.user" }),
    true
  );
  assert.equal(sameIdentity({ id: "one" }, { id: "two" }), false);
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
});

test("getPullRequests queries active PRs in every repository and classifies them", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(url);

    if (url.includes("/_apis/connectionData")) {
      return jsonResponse({
        authenticatedUser: { id: "user-id", displayName: "Ada Lovelace" }
      });
    }
    if (url.includes("/_apis/projects")) {
      return jsonResponse({ value: [{ id: "project-id" }] });
    }
    if (url.endsWith("/_apis/git/repositories?api-version=7.1")) {
      return jsonResponse({
        value: [{
          id: "repository-id",
          name: "web",
          webUrl: "https://dev.azure.com/contoso/app/_git/web",
          project: { id: "project-id", name: "app" }
        }]
      });
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

  const result = await getPullRequests("contoso", "token", fetchImpl);

  assert.equal(result.displayName, "Ada Lovelace");
  assert.equal(urls.length, 4);
  assert.equal(result.projectCount, 1);
  assert.equal(result.repositoryCount, 1);
  assert.equal(result.authored.length, 1);
  assert.equal(result.reviewRequested.length, 1);
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
