# mod-panel

Adds a **Mods** button under the prompt. It opens a panel to turn each installed mod on or off.

## Use

- Click **Mods ▾** to open the panel, and **Mods ▴** to close it.
- `/mods` opens or closes the panel too.
- Only installed mods are listed. With none installed, the button is hidden.

## Keyboard

In the panel:

- Tab or the arrow keys move between switches.
- Enter switches the selected mod. `1`, `2` and so on switch a mod by its row.
- Esc closes the panel.

## Shortcut

A mod can't add a key binding, so add one yourself. Put this in `~/.claude/keybindings.json`, or merge it into the file if you already have one:

```json
{
  "bindings": [
    { "context": "Chat", "bindings": { "ctrl+x m": "command:mods" } }
  ]
}
```

Press `ctrl+x`, let go of ctrl, then press `m`. Each press opens or closes the panel.

## Mods it controls

- `minimal-view`
- `context-bar`
