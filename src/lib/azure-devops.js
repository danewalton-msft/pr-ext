const API_VERSION = "7.1";
const CONNECTION_API_VERSION = "7.1-preview";
const PAGE_SIZE = 100;

export class AzureDevOpsApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "AzureDevOpsApiError";
    this.status = status;
  }
}

export async function getPullRequests(
  organization,
  token,
  repositoryFilters = "",
  fetchImpl = fetch
) {
  const organizationName = normalizeOrganization(organization);
  const configuredRepositories = parseRepositoryFilters(
    repositoryFilters,
    organizationName
  );
  const user = await getAuthenticatedUser(organizationName, token, fetchImpl);
  let projects = [];
  let repositories = configuredRepositories;

  if (repositories.length === 0) {
    projects = await getProjects(organizationName, token, fetchImpl);
    const projectRepositories = await mapWithConcurrency(
      projects,
      4,
      (project) => getProjectRepositories(
        organizationName,
        project.id,
        token,
        fetchImpl
      )
    );
    repositories = projectRepositories
      .flat()
      .filter((repository) => !repository.isDisabled);
  }

  const repositoryResults = await mapWithConcurrency(
    repositories,
    6,
    async (repository) => {
      try {
        const pullRequests = await getRepositoryPullRequests(
          organizationName,
          repository.project.id,
          repository.id,
          token,
          fetchImpl
        );
        return { pullRequests, skippedRepository: null };
      } catch (error) {
        if (isRepositoryAccessError(error)) {
          return {
            pullRequests: [],
            skippedRepository: `${repository.project.name}/${repository.name}`
          };
        }
        throw error;
      }
    }
  );
  const activePullRequests = repositoryResults.flatMap(
    (result) => result.pullRequests
  );
  const skippedRepositories = repositoryResults
    .map((result) => result.skippedRepository)
    .filter(Boolean);

  const authored = normalizePullRequests(
    activePullRequests.filter((pullRequest) =>
      user.matchingIdentities.some((identity) =>
        sameIdentity(pullRequest.createdBy, identity)
      )
    ),
    organizationName
  );
  const reviewRequested = normalizePullRequests(
    activePullRequests.filter((pullRequest) =>
      needsUserReview(pullRequest, user.matchingIdentities)
    ),
    organizationName
  );

  return {
    displayName: user.displayName,
    projectCount: configuredRepositories.length > 0
      ? new Set(repositories.map((repository) => repository.project.name)).size
      : projects.length,
    repositoryCount: repositories.length,
    repositoryFilterActive: configuredRepositories.length > 0,
    skippedRepositories,
    activePullRequestCount: activePullRequests.length,
    authored,
    reviewRequested
  };
}

export async function getAuthenticatedUser(organization, token, fetchImpl = fetch) {
  const response = await azureRequest(
    organization,
    "/_apis/connectionData",
    { "api-version": CONNECTION_API_VERSION },
    token,
    fetchImpl
  );
  const identities = [
    response.body.authorizedUser,
    response.body.authenticatedUser
  ].filter(Boolean);
  const primary = response.body.authorizedUser ?? response.body.authenticatedUser;

  return {
    ...primary,
    displayName: primary.displayName ?? primary.providerDisplayName,
    matchingIdentities: deduplicateIdentities(identities)
  };
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

export async function getProjectRepositories(
  organization,
  projectId,
  token,
  fetchImpl = fetch
) {
  const response = await azureRequest(
    organization,
    `/${encodeURIComponent(projectId)}/_apis/git/repositories`,
    { "api-version": API_VERSION },
    token,
    fetchImpl
  );
  return response.body.value;
}

export async function getRepositoryPullRequests(
  organization,
  projectId,
  repositoryId,
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

    const response = await azureRequest(
      organization,
      `/${encodeURIComponent(projectId)}/_apis/git/repositories/${encodeURIComponent(repositoryId)}/pullrequests`,
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

export function sameIdentity(left, right) {
  if (!left || !right) {
    return false;
  }

  const leftAliases = identityAliases(left);
  return [...identityAliases(right)].some((alias) => leftAliases.has(alias));
}

function isRepositoryAccessError(error) {
  return error instanceof AzureDevOpsApiError &&
    [401, 403, 404].includes(error.status);
}

export function needsUserReview(pullRequest, userIdentities) {
  if (pullRequest.isDraft) {
    return false;
  }

  const identities = Array.isArray(userIdentities)
    ? userIdentities
    : [{ id: userIdentities }];
  const reviewer = pullRequest.reviewers
    ?.flatMap((candidate) => [candidate, ...(candidate.votedFor ?? [])])
    .find((candidate) =>
      identities.some((identity) => sameIdentity(candidate, identity))
    );
  return Boolean(reviewer && (reviewer.vote === 0 || reviewer.isFlagged));
}

function deduplicateIdentities(identities) {
  return identities.filter((identity, index) =>
    identities.findIndex((candidate) => sameIdentity(candidate, identity)) === index
  );
}

function identityAliases(identity) {
  const properties = identity.properties ?? {};
  const values = [
    identity.id,
    identity.descriptor,
    identity.subjectDescriptor,
    identity.uniqueName,
    identity.displayName,
    identity.providerDisplayName,
    identity.customDisplayName,
    propertyValue(properties.Account),
    propertyValue(properties.AccountName),
    propertyValue(properties.Email),
    propertyValue(properties.Mail)
  ];

  return new Set(
    values
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim().toLowerCase())
  );
}

function propertyValue(value) {
  return typeof value === "object" && value !== null ? value.$value : value;
}

export function normalizePullRequests(items, organization) {
  const byUrl = new Map();

  for (const item of items) {
    if (
      !item.repository?.name ||
      !item.repository?.project?.name ||
      !item.pullRequestId
    ) {
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
  if (pullRequest.repository.webUrl?.startsWith("https://dev.azure.com/")) {
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

export function parseRepositoryFilters(value, organization) {
  const organizationName = normalizeOrganization(organization);
  const repositories = new Map();
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let projectName;
    let repositoryName;

    if (line.includes("://")) {
      const url = new URL(line);
      if (url.hostname !== "dev.azure.com") {
        throw new Error(`Repository URL must use dev.azure.com: ${line}`);
      }

      const [urlOrganization, project, gitSegment, repository] =
        url.pathname.split("/").filter(Boolean);
      if (
        urlOrganization !== organizationName ||
        gitSegment !== "_git" ||
        !project ||
        !repository
      ) {
        throw new Error(`Invalid repository URL for ${organizationName}: ${line}`);
      }
      projectName = decodeURIComponent(project);
      repositoryName = decodeURIComponent(repository);
    } else {
      const parts = line.split("/");
      if (parts.length !== 2 || !parts[0].trim() || !parts[1].trim()) {
        throw new Error(`Use Project/Repository format: ${line}`);
      }
      [projectName, repositoryName] = parts.map((part) => part.trim());
    }

    const key = `${projectName.toLowerCase()}/${repositoryName.toLowerCase()}`;
    repositories.set(key, {
      id: repositoryName,
      name: repositoryName,
      project: {
        id: projectName,
        name: projectName
      }
    });
  }

  return [...repositories.values()];
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
