# PR Tab Groups

PR Tab Groups is a Manifest V3 extension for Microsoft Edge that tracks selected Azure DevOps and GitHub repositories, then finds:

- Pull requests authored by you.
- Non-draft pull requests awaiting your review.

It opens or reuses each pull request tab in the most recently focused Edge window and organizes the tabs into separate colored groups. Pull requests that match both searches appear in the review group. When a PR no longer matches, its tab is removed from the managed group but remains open.

## Install

1. Create credentials for either or both providers. Azure DevOps needs **Code: Read** and, for full-organization scans, **Project and Team: Read**. GitHub needs a fine-grained PAT with **Pull requests: Read** and **Contents: Read** for the selected repositories.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository directory.
5. Open the extension, select **Settings**, configure Azure DevOps, GitHub, or both, and select **Save and sync**.

Tokens are stored in Edge extension local storage and sent only to their respective provider APIs. Automatic synchronization runs every 15 minutes by default and can be reduced to 5 minutes. The extension badge shows the combined number of pull requests awaiting your review.

For faster syncs, add one repository per line in Settings using `Project/Repository` or a full `https://dev.azure.com/.../_git/...` repository URL. When this list is populated, project and repository discovery is skipped and only the selected repositories are queried. Leave it empty to scan the whole organization.

GitHub requires a repository list. Enter one repository per line as `owner/repository` or `https://github.com/owner/repository`.

Settings warns when full-organization scanning is enabled, especially with the 5-minute interval. The default active tab groups are **🚀 My open PRs**, **👀 Review requested**, and **📌 Assigned / following**; all titles remain customizable.

Across both providers, PRs created by configured automation identities (default: `Agency` and `GitHub Copilot`) are also treated as yours when their commits use your author identity or contain a matching `Co-authored-by` trailer. These PRs remain in **🚀 My open PRs** after you approve them and only leave when they are no longer active.

Disabled repositories and repositories for which the PAT lacks Code read permission are skipped and reported after each sync; they do not prevent accessible repositories from being grouped.

By default, tabs for PRs that stop matching move to a collapsed green **✅ Complete** group. Settings can instead close them or leave them open and ungrouped. Only URLs recorded by the previous successful sync are affected; unrelated tabs are never closed or moved. If a completed PR becomes active and matches again, its tab moves back to the appropriate active group.

## Review attention rules

A pull request appears in the review group when it is active, is not a draft, lists you as a reviewer, and either your vote is **No vote** (`0`) or Azure DevOps has flagged you for attention. PRs you have approved are omitted unless they are flagged again.

For GitHub, the extension uses GitHub's `review-requested` search so direct and team-based review requests are included.

The assigned/following group contains active Azure DevOps PRs where you remain a reviewer but have no current review action, plus GitHub PRs where you are an assignee. Review requests take priority over authored/owned PRs, which take priority over assigned/following.

To dismiss review requests you do not plan to handle, open the extension and select one or more PRs under **Review requests**, then choose **Move selected to 📌 Following**. The current PR tab also has a one-click action. Overrides persist across refreshes while PRs remain active and can be batch-restored under **Following overrides**.

## Development

No build step or third-party dependencies are required.

```sh
npm test
```
