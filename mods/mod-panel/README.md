# mod-panel

Adds a **Mods** button under the prompt. It opens a panel to turn each installed mod on or off.

## Use

- Click **Mods ▾** to open the panel, and **Mods ▴** to close it.
- `/mods` opens or closes the panel too.
- Only installed mods are listed. With none installed, the button is hidden.
- Switching a mod leaves nothing in the conversation.
- Click **Context Tracker ▸** to see the context window's usage in the panel, even while the bar above the prompt is off.

## Keyboard

In the panel:

- Tab or the arrow keys move between switches.
- Enter switches the selected mod. `1`, `2` and so on switch a mod by its row.
- Esc closes the panel.

## Shortcut

A mod can't add a key binding, so add one yourself. The **Mods** button answers the `app:toggleReplTab` action, so bind your key to it. Put this in `~/.claude/keybindings.json`, or merge it into the file if you already have one:

```json
{
  "bindings": [
    { "context": "Global", "bindings": { "ctrl+x m": "app:toggleReplTab" } }
  ]
}
```

Press `ctrl+x`, let go of ctrl, then press `m`. Each press opens or closes the panel, as a click on the button does.

## Mods it controls

- `minimal-view`
- `context-tracker`
