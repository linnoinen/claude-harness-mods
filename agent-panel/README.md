# agent-panel

Side panel that lists the subagents working right now and what each one is doing.

- Each row shows the agent's task, type, elapsed time, number of tool calls and the tool call it is on now. Finished agents stay below, dimmed.
- Click an agent to see its task and a log of its recent tool calls (newest first). **Open transcript** switches the main view to that agent; **← All agents** goes back.
- `/agent-panel` brings the pane up.

When the github-panel mod is installed, the agents list is drawn as the lower half of its right-hand pane (about 45% of the rows, GitHub above it). Without github-panel, or if its pane isn't drawn within a few seconds, it opens as a pane of its own.
