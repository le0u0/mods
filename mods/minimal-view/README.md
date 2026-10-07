# minimal-view

Hides tool calls and shows a plain checklist of Claude's plan above the prompt.

## Use

- `/minimal` switches it on or off. `/minimal on` and `/minimal off` set it.
- The setting is kept across sessions.

## What you see

- Each step of the plan, with a progress bar. A finished step is checked off.
- **Needs you** when Claude asks a question or waits for your OK.
- **Stuck** when a step fails three times in a row.
- **All done** with the time and tokens the job took. It folds to one line after 5 seconds.
- **Stopped** when you press Esc.

## How it works

While it is on, Claude must lay out its plan with the `plan_steps` tool before it uses other tools, and reports progress with `report_progress`. If Claude uses a to-do list instead, that list becomes the checklist.
