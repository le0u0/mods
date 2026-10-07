# mods

A collection of [Claude Code](https://claude.com/claude-code) mods: plugins that add panes, status lines, slash commands and hooks to your Claude Code session.

Install every mod at once, or pick only the ones you want. Each mod works on its own.

Requires Claude Code 2.1.287 or later.

## Mods

| Mod | What it does |
| --- | --- |
| `all` | Installs every mod below in one step |
| [`minimal-view`](mods/minimal-view/README.md) | Hides tool calls and shows a plain checklist of the plan above the prompt |
| [`context-tracker`](mods/context-tracker/README.md) | Shows how full the context window is, by category, in a bar above the prompt |
| [`usage-tracker`](mods/usage-tracker/README.md) | Shows how much of your plan's usage limit is used, and what the last request took, under the prompt |
| [`mod-panel`](mods/mod-panel/README.md) | Adds a **Mods** button under the prompt that opens a panel to turn each mod on or off |

## Install

Run these lines at the prompt of a Claude Code terminal session.

Add the marketplace once:

```
/plugin marketplace add le0u0/mods
```

### Everything

```
/plugin install all@mods
```

### One mod

```
/plugin install <mod>@mods
```

Replace `<mod>` with a name from the table above. Each mod's page says how to use it.
