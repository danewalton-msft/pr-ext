# PR Tab Groups

PR Tab Groups is a dependency-free Manifest V3 extension for Microsoft Edge. It queries configured Azure DevOps and GitHub repositories, opens or reuses matching pull request tabs in the most recently focused Edge window, and organizes them into:

- **🚀 My open PRs**: active PRs authored by you, plus supported automation-created PRs detected as co-authored by you.
- **👀 Review requested**: active, non-draft PRs that currently need your review.
- **📌 Assigned / following**: active PRs associated with you but requiring no current review action.
- **✅ Complete**: previously managed PR tabs that no longer match an active category, when the default completed-tab behavior is enabled.

Classification precedence is **My open PRs**, then **Review requested**, then **Assigned / following**. A PR appears in only one active group.

## Install or update

1. Open `edge://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository directory.
4. Open **PR Tab Groups**, select **Settings**, configure at least one provider, and select **Save and sync**.

After updating the extension source, select **Reload** for PR Tab Groups on `edge://extensions`, then run **Sync pull requests** from the popup.

## Configure Azure DevOps

Enter:

- Your organization name, such as `contoso`, or its `https://dev.azure.com/contoso` URL.
- An Azure DevOps personal access token with **Code: Read**.
- **Project and Team: Read** on the token when scanning every accessible repository in the organization.

Settings includes a **Create an Azure DevOps PAT** link that targets the configured organization.

For faster and more frequent synchronization, add one repository per line:

```text
Project/Repository
https://dev.azure.com/contoso/Project/_git/Repository
```

When the list is populated, project and repository discovery is skipped. Leave it empty to scan the whole organization. Disabled or inaccessible repositories are skipped and reported without preventing accessible repositories from syncing.

## Configure GitHub

Enter:

- A fine-grained personal access token with **Pull requests: Read** and **Contents: Read** for the selected repositories.
- At least one repository per line:

```text
owner/repository
https://github.com/owner/repository
```

Settings includes a link to create a fine-grained GitHub token. Repository URLs accidentally entered in the other provider's list are automatically routed to the correct provider when settings are saved.

Tokens are stored in Edge extension local storage and sent only to their respective provider APIs.

## Use the popup

Select **Sync pull requests** to refresh immediately. Automatic synchronization runs every 15 minutes by default and can be configured from 5 minutes to 4 hours. The extension badge shows the combined number of PRs currently awaiting your review.

The popup lists:

- Current actionable review requests, with checkboxes and **Select all**.
- All assigned/following PRs, including Azure DevOps PRs you already reviewed.
- Manually dismissed review requests, which have checkboxes so they can be restored.

To dismiss reviews you do not plan to handle:

1. Select the PRs under **Review requests**.
2. Choose **Move selected to 📌 Following**.

To restore dismissed reviews:

1. Under **📌 Assigned / following**, choose **Select manual overrides** or select individual dismissed entries.
2. Choose **Restore selected reviews**.

Automatic following entries are read-only in the popup because they were classified by the provider rather than manually dismissed.

## Grouping rules

### Authored and automation-owned PRs

Directly authored PRs remain in **🚀 My open PRs** while active.

PRs created by configured automation identities also count as yours when at least one commit matches your provider identity through its author, committer, or `Co-authored-by` trailer. The default automation identities are:

```text
Agency
GitHub Copilot
```

These PRs remain in **🚀 My open PRs** after you approve them and do not appear in the popup's review or following action lists. They leave only when they are no longer active.

### Review requested

For Azure DevOps, an active non-draft PR needs your review when you are listed as a reviewer and your vote is **No vote** (`0`) or Azure DevOps flags you for attention. An approved PR leaves this group unless it is flagged for attention again.

For GitHub, the extension uses GitHub's `review-requested` search, including direct and team-based requests.

### Assigned / following

This group contains:

- Active Azure DevOps PRs where you remain a reviewer but have already voted and have no current review action.
- Active GitHub PRs where you are an assignee.
- Review requests you manually moved to following.

An approved but unmerged Azure DevOps PR therefore remains visible in this group while you are still listed as a reviewer, unless it is authored or co-authored by you and belongs in **🚀 My open PRs**.

## Completed and stale tabs

By default, a previously managed PR tab that stops matching moves to a collapsed **✅ Complete** group. Settings can instead:

- Close the tab.
- Leave it open and ungrouped.

Only URLs recorded by a previous successful sync are affected; unrelated tabs are never closed or moved. If a completed PR becomes active and matches again, its tab returns to the appropriate active group.

## Edge split screen

Sync avoids applying a tab-group operation to PR tabs that Edge reports as being in split view, preventing synchronization from breaking the split. Tabs already in the correct group are also left untouched.

Edge may temporarily display a split-view PR outside its tab group. The extension leaves it there while the split is active and groups it again on a later sync after it leaves split view.

## Development

No build step or third-party dependencies are required.

```sh
npm test
```
