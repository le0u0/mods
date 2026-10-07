# usage-tracker

Shows how much of your plan's usage limit is used, and what the last request took, under the prompt.

## Use

- `/usage-tracker` shows or hides it. `/usage-tracker on` and `/usage-tracker off` set it.
- The setting is kept across sessions.

## What you see

Under the prompt, next to the **Mods** button:

```
◇ usage 57% · last +1.5%
```

- **usage 57%**: how much of the current session's limit, the 5-hour window, is used.
- **last +1.5%**: how much your latest request used of that window. It settles a few seconds after the request ends, and shows `+0%` when the request did not move the window. Use from other sessions while you are idle moves the first figure only.

It needs a Claude plan. With an API key there are no usage limits, so nothing shows.

## In the Mods panel

With [mod-panel](../mod-panel/README.md) installed, open **Usage Tracker** in the panel (its number, or a click on its name) to see every limit side by side:

```
Session · 5 hours                 Week · all models
█████▉░░░░░░░░░░░░░░░░░░░░░░      █████████████████▎░░░░░░░░░░
11% used · resets 5:50pm          62% used · resets Oct 10, 8pm
```

The gray part of each bar is what is left.
