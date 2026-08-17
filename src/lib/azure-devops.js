const API_VERSION = "7.1";
const PAGE_SIZE = 100;

export class AzureDevOpsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AzureDevOpsApiError";
    this.status = status;
  }
}

export async function getPullRequests(organization, token, fetchImpl = fetch) {
  const organizationName = normalizeOrganization(organization);
  const [user, projects] = await Promise.all([
    getAuthenticatedUser(organizationName, token, fetchImpl),
    getProjects(organizationName, token, fetchImpl)
  ]);

  const projectResults = await mapWithConcurrency(projects, 4, async (project) => {
    const [authored, assignedForReview] = await Promise.all([
      getProjectPullRequests(
        organizationName,
        project.id,
        { creatorId: user.id },
        token,
        fetchImpl
      ),
      getProjectPullRequests(
        organizationName,
        project.id,
        { reviewerId: user.id },
        token,
        fetchImpl
      )
    ]);

    return { authored, assignedForReview };
  });

  const authored = normalizePullRequests(
    projectResults.flatMap((result) => result.authored),
    organizationName
  );
  const reviewRequested = normalizePullRequests(
    projectResults
      .flatMap((result) => result.assignedForReview)
      .filter((pullRequest) => needsUserReview(pullRequest, user.id)),
    organizationName
  );

  return {
    displayName: user.displayName,
    authored,
    reviewRequested
  };
}

export async function getAuthenticatedUser(organization, token, fetchImpl = fetch) {
  const response = await azureRequest(
    organization,
    "/_apis/connectionData",
    { "api-version": API_VERSION },
    token,
    fetchImpl
  );
  return response.body.authenticatedUser;
}

export async function getProjects(organization, token, fetchImpl = fetch) {
  const projects = [];
  let continuationToken;

  do {
    const params = {
      "api-version": API_VERSION,
      "$top": String(PAGE_SIZE)
    };
    if (continuationToken) {
      params.continuationToken = continuationToken;
    }

    const response = await azureRequest(
      organization,
      "/_apis/projects",
      params,
      token,
      fetchImpl
    );
    projects.push(...response.body.value);
    continuationToken = response.continuationToken;
  } while (continuationToken);

  return projects;
}

export async function getProjectPullRequests(
  organization,
  projectId,
  criteria,
  token,
  fetchImpl = fetch
) {
  const pullRequests = [];

  for (let skip = 0; ; skip += PAGE_SIZE) {
    const params = {
      "api-version": API_VERSION,
      "searchCriteria.status": "active",
      "$top": String(PAGE_SIZE),
      "$skip": String(skip)
    };

    if (criteria.creatorId) {
      params["searchCriteria.creatorId"] = criteria.creatorId;
    }
    if (criteria.reviewerId) {
      params["searchCriteria.reviewerId"] = criteria.reviewerId;
    }

    const response = await azureRequest(
      organization,
      `/${encodeURIComponent(projectId)}/_apis/git/pullrequests`,
      params,
      token,
      fetchImpl
    );
    pullRequests.push(...response.body.value);

    if (response.body.value.length < PAGE_SIZE) {
      break;
    }
  }

  return pullRequests;
}

export function needsUserReview(pullRequest, userId) {
  if (pullRequest.isDraft) {
    return false;
  }

  const reviewer = pullRequest.reviewers
    ?.flatMap((candidate) => [candidate, ...(candidate.votedFor ?? [])])
    .find((candidate) => candidate.id.toLowerCase() === userId.toLowerCase());
  return Boolean(reviewer && (reviewer.vote === 0 || reviewer.isFlagged));
}

export function normalizePullRequests(items, organization) {
  const byUrl = new Map();

  for (const item of items) {
    if (!item.repository?.webUrl || !item.pullRequestId) {
      continue;
    }

    const url = pullRequestWebUrl(item, organization);
    byUrl.set(url, {
      title: item.title,
      url,
      repository: item.repository.name,
      project: item.repository.project?.name ?? "",
      number: item.pullRequestId,
      updatedAt: item.creationDate
    });
  }

  return [...byUrl.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function pullRequestWebUrl(pullRequest, organization) {
  if (pullRequest.repository.webUrl.startsWith("https://dev.azure.com/")) {
    return `${pullRequest.repository.webUrl}/pullrequest/${pullRequest.pullRequestId}`;
  }

  const project = encodeURIComponent(pullRequest.repository.project.name);
  const repository = encodeURIComponent(pullRequest.repository.name);
  return `https://dev.azure.com/${normalizeOrganization(organization)}/${project}/_git/${repository}/pullrequest/${pullRequest.pullRequestId}`;
}

export function canonicalPullRequestUrl(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function normalizeOrganization(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  if (!trimmed.includes("://")) {
    return trimmed.replace(/^\/|\/$/g, "");
  }

  const url = new URL(trimmed);
  if (url.hostname !== "dev.azure.com") {
    throw new Error("Use an Azure DevOps organization URL from dev.azure.com.");
  }

  const [organization] = url.pathname.split("/").filter(Boolean);
  return organization ?? "";
}

async function azureRequest(organization, path, params, token, fetchImpl) {
  const url = new URL(`https://dev.azure.com/${organization}${path}`);
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  const response = await fetchImpl(url.toString(), {
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${btoa(`:${token}`)}`
    }
  });

  if (!response.ok) {
    let message = `Azure DevOps request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // Keep the status-based message when Azure DevOps does not return JSON.
    }
    throw new AzureDevOpsApiError(message, response.status);
  }

  return {
    body: await response.json(),
    continuationToken: response.headers?.get("x-ms-continuationtoken") ?? null
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}
