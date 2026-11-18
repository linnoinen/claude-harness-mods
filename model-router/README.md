# model-router

A Claude Code mod that routes each prompt to a fitting model and effort level.

- **Smart router (on by default, per session).** Before each main-loop turn, a classifier sorts the prompt (with a few lines of recent conversation) into `trivial`, `simple`, `standard`, `complex` or `deep`, and every model request of that turn is sent to the matching model and effort:

  | Category | Model | Effort |
  | --- | --- | --- |
  | trivial | haiku | low |
  | simple | sonnet | low |
  | standard | sonnet | medium |
  | complex | opus | high |
  | deep | opus | xhigh |

  Continuation turns keep the previous route. If the classifier fails, the turn runs as `standard`. Subagents are left alone.
- **Router tab** in the right-hand panel: every turn with time, category, model and effort. Click one for the prompt, the classifier's reason and latency, the model that answered, request count, tokens and duration. The tab also has the on/off toggle and the classifier picker.
- **Band row above the prompt**: router on/off toggle and the last route; with the router off, Model and Effort pickers that apply to every turn (leave both on default to use the session's own settings).
- `/router on | off | log | status`.

## Classifier

Pick it in the mod's options (`/config`) or in the Router tab (session only). Default: `haiku`.

- `haiku` (latest Haiku alias) or `claude-haiku-5-5` (pinned).
- `jev`: sends one `choice` question to TypeSafe Jev (`POST https://api.typesafe.ai/v1/systemone`, model `jev-latest` unless `externalModel` is set) and reads `answers.route.choice` and its `confidence`. `externalMinConfidence` (0-1) hands low-confidence answers to Haiku.
- `openai` / `simple`: your own endpoint (`externalUrl`): `openai` sends a chat-completions request and reads `choices[0].message.content`; `simple` POSTs `{ system, prompt, labels }` and accepts JSON `{ category, reason }` or text containing it.
- API key: set the `TYPESAFE_API_KEY` environment variable before starting Claude Code (e.g. `export TYPESAFE_API_KEY=...` in your shell profile), or the `externalApiKey` option. It is sent as a Bearer token. A secret option has no row in `/config`; set it under `pluginConfigs.model-router.options` in settings, or prefer the environment variable.

If the external service fails, Haiku is tried, then the `standard` fallback; the log entry says so. The external service receives the prompt and recent conversation text.

## Notes

Switching models between turns starts a fresh prompt cache for that model, so routing trades some cache reuse for cheaper or stronger models per task. Token figures are the engine's estimates.

## Install

```
/plugin install model-router --marketplace linnoinen/claude-harness-mods
```
