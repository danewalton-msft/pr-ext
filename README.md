# PR Tab Groups

PR Tab Groups is a Manifest V3 extension for Microsoft Edge that enumerates every accessible project and repository in an Azure DevOps organization, then finds:

- Pull requests authored by you.
- Non-draft pull requests where you have not voted yet or are flagged for attention.

It opens or reuses each pull request tab in the most recently focused Edge window and organizes the tabs into separate colored groups. Pull requests that match both searches appear in the review group. When a PR no longer matches, its tab is removed from the managed group but remains open.

## Install

1. In Azure DevOps, create a personal access token with **Code: Read** and **Project and Team: Read** access.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this repository directory.
5. Open the extension, select **Settings**, enter your Azure DevOps organization and PAT, and select **Save and sync**.

The organization can be entered as `contoso` or `https://dev.azure.com/contoso`. The PAT is stored in Edge extension local storage and is sent only to `dev.azure.com`. Automatic synchronization runs every 15 minutes by default and can be reduced to 5 minutes. The extension badge shows the number of pull requests awaiting your review.

For faster syncs, add one repository per line in Settings using `Project/Repository` or a full `https://dev.azure.com/.../_git/...` repository URL. When this list is populated, project and repository discovery is skipped and only the selected repositories are queried. Leave it empty to scan the whole organization.

Settings warns when full-organization scanning is enabled, especially with the 5-minute interval. The default tab groups are **🚀 My open PRs** and **👀 Review requested**; both titles remain customizable.

Disabled repositories and repositories for which the PAT lacks Code read permission are skipped and reported after each sync; they do not prevent accessible repositories from being grouped.

## Review attention rules

A pull request appears in the review group when it is active, is not a draft, lists you as a reviewer, and either your vote is **No vote** (`0`) or Azure DevOps has flagged you for attention. PRs you have approved are omitted unless they are flagged again.

## Development

No build step or third-party dependencies are required.

```sh
npm test
```
