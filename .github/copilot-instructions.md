# PR Tab Groups project instructions

## Product intent

This is a dependency-free Microsoft Edge Manifest V3 extension that tracks Azure DevOps and GitHub pull requests and organizes their tabs. Preserve the user's ability to monitor PRs through completion, especially automation-created PRs authored by Agency or GitHub Copilot but co-authored by the current user.

## Architecture

- `manifest.json`: Manifest V3 permissions, service worker, popup, and options page.
- `src/background.js`: provider orchestration, persisted state, alarms, popup messages, classification output, badge updates, and tab grouping.
- `src/lib/azure-devops.js`: Azure DevOps API calls, identity matching, repository filtering, PR classification, and automation ownership detection.
- `src/lib/github.js`: GitHub API calls, repository filtering, PR classification, and automation ownership detection.
- `src/lib/provider-results.js`: merges provider results and enforces category precedence and manual review dismissals.
- `src/lib/tab-sync.js`: pure tab grouping and stale-tab decisions.
- `src/lib/settings.js`: defaults, migrations, validation, and provider repository URL routing.
- `src/lib/extension-events.js`: prevents Edge service-worker shutdowns from becoming unhandled promise rejections.
- `src/popup.*`: current status, review dismissal, batch selection, and restoration.
- `src/options.*`: provider credentials, repository lists, group titles, refresh interval, and stale-tab behavior.
- `test/*.test.js`: Node built-in tests for pure logic and mocked provider calls.

There is no build step and no third-party runtime or test dependency.

## Required behavior

Active category precedence is:

1. **🚀 My open PRs**
2. **👀 Review requested**
3. **📌 Assigned / following**

A PR must appear in only one active category.

- Directly authored PRs stay in **My open PRs** while active.
- Automation-created PRs count as owned when the creator matches a configured automation identity and at least one commit author, committer, or `Co-authored-by` trailer matches the current provider identity.
- Owned/co-authored PRs always win over review requests and assignments. They must not appear in popup review/following action lists, including after the user approves them.
- Azure DevOps PRs needing review are active, non-draft, list the user as a reviewer, and have vote `0` or an attention flag.
- Azure DevOps PRs where the user already voted remain in **Assigned / following** while active and still assigned as reviewer.
- GitHub review requests come from `review-requested`; GitHub assignments go to **Assigned / following**.
- Manually dismissed reviews move to following and remain restorable while the PR is active.
- Popup counts and lists must be derived from the final post-precedence classification, not raw provider overlaps.

## Tab lifecycle invariants

- Reuse a canonical PR URL in the most recently focused normal Edge window before creating a new tab.
- Do not repeatedly call `chrome.tabs.group` for a tab already in the target group.
- Do not group a tab while Edge reports it in split view. Preserve the split and regroup after it leaves split view.
- Only tabs whose URLs were recorded by a previous successful sync may be closed, ungrouped, or moved to **✅ Complete** as stale.
- Never move or close unrelated tabs.
- Edge removes empty tab groups automatically; do not assume an empty group persists.

## Provider constraints

### Azure DevOps

- `connectionData` requires `api-version=7.1-preview`.
- Projects, repositories, Git, PR, and commit APIs use `7.1`.
- Query active PRs per repository; organization-wide PR querying is not reliable for this use case.
- PR list responses may omit `repository.webUrl`. Construct browser URLs as `https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}`.
- Repository discovery can return inaccessible or disabled repositories (`TF401019`). Skip and report these rather than failing the full sync.
- Identity matching must consider IDs, descriptors, account properties, emails, unique names, and display names.

### GitHub

- Repository configuration is required and accepts `owner/repository` or a repository URL.
- Fine-grained tokens need **Pull requests: Read** and **Contents: Read**.
- Use REST API bearer authentication and preserve pagination behavior.

## Persistence and security

`chrome.storage.local` contains settings, sync status, managed PR URLs, and dismissed review URLs. Settings include provider tokens.

- Never print, expose, commit, or copy token values.
- `.env.local` may contain local debugging credentials and is gitignored. Do not display its contents.
- Send credentials only to their corresponding provider API.
- Keep errors explicit, but treat Edge's exact transient `No SW` service-worker shutdown error as a normal lifecycle event.

## Change conventions

- Use modern vanilla JavaScript ES modules and existing helpers.
- Keep provider-specific normalization in provider modules and cross-provider precedence in `provider-results.js`.
- Put testable decision logic in `src/lib/` rather than embedding it entirely in browser event handlers.
- Update `README.md` whenever setup, usage, grouping, popup actions, permissions, or lifecycle behavior changes.
- Do not add dependencies or a build system unless the requested feature cannot reasonably be implemented without them.

## Validation

Run the smallest relevant checks, with this full baseline available:

```sh
npm test
node --check src/background.js
node --check src/popup.js
node --check src/options.js
git diff --check
```
