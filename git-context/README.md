# git-context

A Claude Code mod that adds a band above the prompt bar showing the repository and branch you are working on, how many commits are incoming (behind upstream) and outgoing (ahead of upstream), and how many files are changed. A Details button expands a panel with the repo root, upstream, staged, modified, untracked and conflicted counts, stashes, last commit, remote URL and working directory. It refreshes on session start, after each turn and Bash call, and every 15 seconds. Incoming counts reflect the last fetch; the mod never touches the network.
