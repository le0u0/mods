# context-bar

Shows how full the context window is, by category, in a bar above the prompt.

## Use

- `/context-bar` shows or hides the bar. `/context-bar on` and `/context-bar off` set it.
- The setting is kept across sessions.

## What you see

- Tokens used, the window size, and when auto-compact starts.
- How many tokens the last turn added, such as `+7.4k`.
- One colored segment per category: tools, skills, messages, system prompt, MCP, memory files, agents and free space.

## Controls

- The arrow next to **context** folds the bar to one line.
- The arrow next to a category lists what is in it, such as each skill or MCP server. Long lists show 10 at a time; press **more** for the next 10.
