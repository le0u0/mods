# mods

A collection of [Claude Code](https://claude.com/claude-code) mods: plugins that add panes, status lines, slash commands and hooks to your Claude Code session.

Install every mod at once, or pick only the ones you want. Each mod works on its own.

Requires Claude Code 2.1.287 or later.

## Mods

| Mod | What it does |
| --- | --- |
| `all` | Installs every mod below in one step |
| `minimal-view` | Hides tool calls and shows a plain checklist of the plan above the prompt. `/minimal on\|off` |

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

Replace `<mod>` with a name from the table above.
