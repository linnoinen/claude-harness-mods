# claude-harness-mods

Mods for Claude Code.

## git-context

A band above the prompt bar showing the repo and branch you are working on, how many commits are incoming (`↓`) and outgoing (`↑`), and how many files changed. A **Details** button opens a panel with the repo root, upstream, staged/modified/untracked/conflicted counts, stashes, last commit, remote and working directory. It never touches the network, so incoming counts update after a `git fetch`.

### Install

In a Claude Code terminal session:

```
/plugin install git-context --marketplace linnoinen/claude-harness-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install git-context --marketplace linnoinen/claude-harness-mods`.
