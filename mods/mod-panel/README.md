# mod-panel

Adds a **Mods** button under the prompt. It opens a panel to turn each installed mod on or off.

## Use

- Click **Mods ▾** to open the panel, and **Mods ▴** to close it.
- `/mods` opens or closes the panel too.
- Only installed mods are listed. With none installed, the button is hidden.
- Switching a mod leaves nothing in the conversation.
- A tracker's page shows its figures even while the tracker is off.
- The panel grows to fit its page, unless you resized it yourself: then it keeps your size.
- `ctrl+x ↑` makes the panel taller and `ctrl+x ↓` shorter. In the fullscreen layout it can take at most a third of the terminal's height.

## Pages

The panel opens on the list of mods. Each mod also has its own page: its switch, what it does, and its details, such as the context window or your usage limits.

- Press a mod's number, or click its name, to open its page.
- Press `q`, or click **← Mods**, to go back to the list.
- Esc closes the panel from any page.

## Keyboard

In the panel:

- In the list, ↑ and ↓ move from one mod's name to the next, and Space opens its page. Click a switch to turn a mod on or off from the list.
- On a mod's page, Space presses its switch.
- Enter works wherever Space does.
- `1`, `2` and so on open a mod's page. `q` goes back.
- Esc closes the panel.

Claude Code itself moves with Tab and presses with Enter in a panel; ↑ and ↓ scroll. For the keys above, add this to `~/.claude/keybindings.json`:

```json
{ "context": "Pane", "bindings": { "space": "abovePrompt:press", "up": "abovePrompt:previous", "down": "abovePrompt:next" } }
```

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
- `usage-tracker`
