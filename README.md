# claude-harness-mods

A collection of mods for Claude Code. Each mod lives in its own folder.

| Mod | What it does |
| --- | --- |
| [git-context](git-context) | Band above the prompt with repo, branch, incoming/outgoing commits and session info. |
| [github-panel](github-panel) | Side panel for GitHub Actions runs and pull requests, with PR watching. |
| [agent-panel](agent-panel) | Side panel listing running subagents and what each is doing; click one for its task log. |
| [model-router](model-router) | Smart model router: classifies each prompt (Haiku or TypeSafe Jev) and runs it on a fitting model and effort; Router log tab and manual model/effort picker. |

## Install

```
/plugin install <mod> --marketplace linnoinen/claude-harness-mods
```

Answer `y` to add the marketplace, then pick a scope. From a shell: `claude plugin install <mod> --marketplace linnoinen/claude-harness-mods`.
