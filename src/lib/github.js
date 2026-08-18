const API_ROOT = "https://api.github.com";
const PAGE_SIZE = 100;

export class GitHubApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

export async function getGitHubPullRequests(
  token,
  repositoryFilters,
  automationAuthors = "Agency\nGitHub Copilot",
  fetchImpl = fetch
) {
  const repositories = parseGitHubRepositoryFilters(repositoryFilters);
  if (repositories.length === 0) {
    throw new Error("Add at least one GitHub repository in Settings.");
  }

  const user = await githubRequest("/user", token, fetchImpl);
  const repositoryResults = await mapWithConcurrency(
    repositories,
    6,
    async (repository) => {
      try {
        const [openPulls, reviewRequested] = await Promise.all([
          getOpenPullRequests(repository, token, fetchImpl),
          getReviewRequestedPullRequests(repository, user.login, token, fetchImpl)
        ]);
        return { repository, openPulls, reviewRequested, skipped: false };
      } catch (error) {
        if (error instanceof GitHubApiError && error.status === 404) {
          return { repository, openPulls: [], reviewRequested: [], skipped: true };
        }
        throw error;
      }
    }
  );

  const openPulls = repositoryResults.flatMap((result) => result.openPulls);
  const directlyAuthored = openPulls.filter(
    (pullRequest) => pullRequest.user?.login?.toLowerCase() === user.login.toLowerCase()
  );
  const directlyAuthoredUrls = new Set(
    directlyAuthored.map((pullRequest) => pullRequest.html_url)
  );
  const automationCandidates = openPulls.filter((pullRequest) =>
    !directlyAuthoredUrls.has(pullRequest.html_url) &&
    isGitHubAutomationPullRequest(pullRequest, automationAuthors)
  );
  const automationOwnedResults = await mapWithConcurrency(
    automationCandidates,
    6,
    async (pullRequest) => {
      const commits = await getPullRequestCommits(
        pullRequest.base.repo.full_name,
        pullRequest.number,
        token,
        fetchImpl
      );
      return commits.some((commit) => commitIncludesGitHubUser(commit, user))
        ? pullRequest
        : null;
    }
  );
  const automationOwned = automationOwnedResults.filter(Boolean);

  return {
    displayName: user.name || user.login,
    repositoryCount: repositories.length,
    skippedRepositories: repositoryResults
      .filter((result) => result.skipped)
      .map((result) => `GitHub: ${result.repository.fullName}`),
    activePullRequestCount: openPulls.length,
    automationOwnedCount: automationOwned.length,
    authored: normalizeGitHubPullRequests([
      ...directlyAuthored,
      ...automationOwned
    ]),
    reviewRequested: normalizeGitHubPullRequests(
      repositoryResults.flatMap((result) => result.reviewRequested)
    )
  };
}

export function parseGitHubRepositoryFilters(value) {
  const repositories = new Map();
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    let owner;
    let repository;

    if (line.includes("://")) {
      const url = new URL(line);
      if (url.hostname !== "github.com") {
        throw new Error(`Repository URL must use github.com: ${line}`);
      }
      [owner, repository] = url.pathname.split("/").filter(Boolean);
    } else {
      [owner, repository] = line.split("/");
    }

    repository = repository?.replace(/\.git$/, "");
    if (!owner?.trim() || !repository?.trim()) {
      throw new Error(`Use owner/repository format: ${line}`);
    }

    const fullName = `${owner.trim()}/${repository.trim()}`;
    repositories.set(fullName.toLowerCase(), { fullName });
  }

  return [...repositories.values()];
}

export function normalizeGitHubPullRequests(items) {
  const byUrl = new Map();

  for (const item of items) {
    if (!item.html_url || !item.number) {
      continue;
    }
    const url = canonicalUrl(item.html_url);
    byUrl.set(url, {
      title: item.title,
      url,
      repository: repositoryFromUrl(url),
      project: "GitHub",
      number: item.number,
      updatedAt: item.updated_at
    });
  }

  return [...byUrl.values()].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function isGitHubAutomationPullRequest(pullRequest, automationAuthors) {
  const authors = String(automationAuthors ?? "")
    .split(/\r?\n/)
    .map(normalizeName)
    .filter(Boolean);
  const creator = normalizeName([
    pullRequest.user?.login,
    pullRequest.user?.name
  ]
    .filter(Boolean)
    .join(" "));
  return authors.some((author) => creator.includes(author));
}

export function commitIncludesGitHubUser(commit, user) {
  const aliases = new Set([
    user.login,
    user.name,
    user.email,
    user.id && user.login ? `${user.id}+${user.login}@users.noreply.github.com` : null,
    user.login ? `${user.login}@users.noreply.github.com` : null
  ].filter(Boolean).map((value) => String(value).toLowerCase()));
  const candidates = [
    commit.author?.login,
    commit.commit?.author?.name,
    commit.commit?.author?.email,
    commit.committer?.login,
    commit.commit?.committer?.name,
    commit.commit?.committer?.email,
    ...coAuthorValues(commit.commit?.message)
  ].filter(Boolean).map((value) => String(value).toLowerCase());
  return candidates.some((candidate) => aliases.has(candidate));
}

async function getOpenPullRequests(repository, token, fetchImpl) {
  return getPaginated(
    `/repos/${repository.fullName}/pulls?state=open&per_page=${PAGE_SIZE}`,
    token,
    fetchImpl
  );
}

async function getReviewRequestedPullRequests(
  repository,
  login,
  token,
  fetchImpl
) {
  const query = encodeURIComponent(
    `repo:${repository.fullName} is:pr is:open draft:false review-requested:${login}`
  );
  const items = [];

  for (let page = 1; ; page += 1) {
    const response = await githubRequest(
      `/search/issues?q=${query}&per_page=${PAGE_SIZE}&page=${page}`,
      token,
      fetchImpl
    );
    items.push(...response.items);
    if (response.items.length < PAGE_SIZE || items.length >= response.total_count) {
      break;
    }
  }

  return items;
}

async function getPullRequestCommits(fullName, number, token, fetchImpl) {
  return getPaginated(
    `/repos/${fullName}/pulls/${number}/commits?per_page=${PAGE_SIZE}`,
    token,
    fetchImpl
  );
}

async function getPaginated(path, token, fetchImpl) {
  const items = [];

  for (let page = 1; ; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const response = await githubRequest(
      `${path}${separator}page=${page}`,
      token,
      fetchImpl
    );
    items.push(...response);
    if (response.length < PAGE_SIZE) {
      break;
    }
  }

  return items;
}

async function githubRequest(path, token, fetchImpl) {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    }
  });

  if (!response.ok) {
    let message = `GitHub request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // Keep the status-based message when GitHub does not return JSON.
    }
    throw new GitHubApiError(message, response.status);
  }

  return response.json();
}

function canonicalUrl(value) {
  const url = new URL(value);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function repositoryFromUrl(value) {
  const [, owner, repository] = new URL(value).pathname.split("/");
  return `${owner}/${repository}`;
}

function coAuthorValues(message = "") {
  const values = [];
  const pattern = /^Co-authored-by:\s*(.*?)\s*<([^>]+)>\s*$/gim;
  let match;

  while ((match = pattern.exec(message)) !== null) {
    values.push(match[1], match[2]);
  }
  return values;
}

function normalizeName(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
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
