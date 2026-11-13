# github-panel

A side panel for GitHub, built on the `gh` CLI (install it and run `gh auth login`).

- **Actions tab:** workflow runs with status, duration and age, for this directory's repo or any project you pick (dropdown, or type `owner/name`).
- **Pull requests tab:** open PRs with check and review state. Click a PR to see the runs on its branch.
- **Browser:** `↗` on a PR or run opens it on GitHub.
- **Watch:** `👁 Watch` on a PR, `/gh-watch 12 [owner/repo]`, or Claude's `watch_pr` tool. Claude is prompted when checks finish, the review decision changes, or the PR is merged or closed, and is asked to look at failing logs.

Opens at session start; `/github-panel [owner/repo|current]` reopens it. Polls every 15 seconds.
