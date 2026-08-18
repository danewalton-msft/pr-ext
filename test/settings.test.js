import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SETTINGS,
  routeRepositoryUrls,
  sanitizeSettings
} from "../src/lib/settings.js";

test("sanitizeSettings trims values and accepts supported settings", () => {
  assert.deepEqual(
    sanitizeSettings({
      token: " token ",
      organization: " contoso ",
      repositories: " App/Web ",
      githubToken: " github-token ",
      githubRepositories: " octo/repo ",
      automationAuthors: " Agency ",
      syncIntervalMinutes: "30",
      authoredGroupTitle: " Mine ",
      reviewGroupTitle: " Reviews ",
      collapseGroups: true,
      staleTabAction: "close"
    }),
    {
      token: "token",
      organization: "contoso",
      repositories: "App/Web",
      githubToken: "github-token",
      githubRepositories: "octo/repo",
      automationAuthors: "Agency",
      syncIntervalMinutes: 30,
      authoredGroupTitle: "Mine",
      reviewGroupTitle: "Reviews",
      collapseGroups: true,
      staleTabAction: "close"
    }
  );
});

test("sanitizeSettings uses safe defaults", () => {
  const settings = sanitizeSettings({
    syncIntervalMinutes: 1,
    authoredGroupTitle: "",
    reviewGroupTitle: " "
  });

  assert.equal(settings.syncIntervalMinutes, 15);
  assert.equal(settings.authoredGroupTitle, DEFAULT_SETTINGS.authoredGroupTitle);
  assert.equal(settings.reviewGroupTitle, DEFAULT_SETTINGS.reviewGroupTitle);
});

test("sanitizeSettings allows a five-minute sync interval", () => {
  assert.equal(
    sanitizeSettings({ syncIntervalMinutes: 5 }).syncIntervalMinutes,
    5
  );
});

test("sanitizeSettings migrates untouched legacy group titles", () => {
  const settings = sanitizeSettings({
    authoredGroupTitle: "My open ADO PRs",
    reviewGroupTitle: "ADO review requested"
  });

  assert.equal(settings.authoredGroupTitle, "🚀 My open PRs");
  assert.equal(settings.reviewGroupTitle, "👀 Review requested");
});

test("sanitizeSettings migrates the legacy close-stale checkbox", () => {
  assert.equal(
    sanitizeSettings({ closeStaleTabs: true }).staleTabAction,
    "close"
  );
});

test("routeRepositoryUrls moves provider URLs to the correct lists", () => {
  assert.deepEqual(
    routeRepositoryUrls(
      "App/Web\nhttps://github.com/Azure/tinykube",
      "octo/api\nhttps://dev.azure.com/contoso/App/_git/Service"
    ),
    {
      azure: "App/Web\nhttps://dev.azure.com/contoso/App/_git/Service",
      github: "https://github.com/Azure/tinykube\nocto/api"
    }
  );
});
