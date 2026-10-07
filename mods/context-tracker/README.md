# context-tracker

Shows how full the context window is, by category, in a bar above the prompt.

## Use

- `/context-tracker` shows or hides the bar. `/context-tracker on` and `/context-tracker off` set it.
- The setting is kept across sessions.

## What you see

- Tokens used, the window size, and when auto-compact starts.
- How many tokens the last turn added, such as `+7.4k`.
- One colored segment per category: tools, skills, messages, system prompt, MCP, memory files, agents and free space.

## Controls

- It starts folded: the percent of the window used sits under the prompt, such as `◆ context 5% ▴`, next to the **Mods** button. Press **▴** to open the card above the prompt, and the arrow next to **context** to fold it again. It remembers which you chose.
- The arrow next to a category lists what is in it, such as each skill or MCP server. Long lists show 10 at a time; press **more** for the next 10.
