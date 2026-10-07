# mods

Claude Code mods repo. Published as a plugin marketplace: `le0u0/mods`.

## Layout

```
.claude-plugin/
  marketplace.json      # lists every mod in this repo
mods/
  all/                  # bundle: depends on every other mod
    .claude-plugin/plugin.json
  <mod>/
    .claude-plugin/plugin.json
    hooks/hooks.json
    hooks/register.tsx
    README.md           # the mod's own user guide
```

## Surfaces

Use these names in code comments, READMEs and talk, so everyone knows where a mod draws and where its next feature goes.

```
 transcript rows                            ← transcript
 ╭ Mods ──────────────────────────────╮
 │ ● Context Tracker         [ ● On ] │      ← panel row
 │ ● Usage Tracker           [ ● On ] │
 ╰────────────────────────────────────╯
 ✓ All done · took 4s                       ← band
 ──────────────────────────────────────
 ❯ chatbox
 ──────────────────────────────────────
     ◆ context 4%  ◇ usage 3%  [ Mods ▾ ]    ← footer
   ⏵⏵ auto mode on (shift+tab to cycle)     ← hint line
```

| Name | Where | Engine site | Used by |
| --- | --- | --- | --- |
| band | Above the chatbox | `AbovePrompt` | minimal-view checklist, context-tracker card |
| footer | Under the chatbox, right side, beside the mode labels | `SessionMode` | context-tracker and usage-tracker figures, the Mods button |
| hint line | Under the chatbox, left: `auto mode on`, `? for shortcuts` | `PromptHint` | none |
| panel | The Mods pane, toggled by the Mods button or `/mods` | `Pane` with `requestId: 'mods'` | mod-panel |
| panel row | One mod's line in the panel: name, hint and switch | inside the panel | every mod in `MODS` |
| mod page | A mod's own page in the panel: its switch by the title, what it does, then its details. Its number opens it, `q` goes back | inside the panel | every mod in `MODS` |
| transcript | The conversation's rows | `ToolUse`, `UserMessage`, `CommandOutput` … | minimal-view hides tool rows |

Behaviors:

- **switch**: the panel turns a mod on or off by writing `{ plugin: 'mod-panel', key: 'switch' }`. The mod hooks that `state.set` and switches itself, so nothing shows in the transcript.
- **fold**: a mod's band card folds into footer figures, and the footer's `▴` unfolds it. context-tracker starts folded.
- **details**: a mod's page draws them from the mod's own state, read with `$.state.get`. The panel can't import a mod's code, so it copies the small helpers it needs.
- **footer figures** stay short: a mark, a dim name and a bold number, then two spaces. The engine moves the whole footer under the hint line when the row runs out of room.

Where a new feature goes:

- Always visible, one line: footer figures.
- Bigger, shown while the person wants it: the band, folded into footer figures by default.
- Looked up on demand: details on the mod page.

## Adding a mod

Do all five steps every time:

1. Create `mods/<mod>/` with the files shown above.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<mod>"`.
3. Add the mod to `dependencies` in `mods/all/.claude-plugin/plugin.json`.
4. Add a row to the Mods table in `README.md`, its name linking to `mods/<mod>/README.md`, and a link to the list in `mods/all/README.md`.
5. If the mod can be turned on and off, add it to `MODS` in `mods/mod-panel/hooks/mod-panel.tsx` with its `hint` and `about` (its page's text), its value to `mods/mod-panel/types/index.d.ts`, and its name to the list in `mods/mod-panel/README.md`. In the mod, hook `state.set` on `{ plugin: 'mod-panel', key: 'switch' }` and switch itself when the request names it, as `minimal-view` does.

## Checking

Run before every commit:

```
claude plugin validate .
claude plugin validate ./mods/<mod>
claude plugin test ./mods/<mod>
```

Load a mod from disk for one session:

```
claude --plugin-dir ./mods/<mod>
```

## README

All READMEs are for users only. Do not add development notes or steps the install UI already shows.

- `README.md` at the root: one table row per mod and how to install. Keep it as short as possible: no commands, options or setup there.
- `mods/<mod>/README.md`: how to use that mod: its commands, what it shows, controls, shortcuts and advanced setup. Update it whenever the mod's behavior changes.

## Long Markdown files

Any `.md` file in this repo over 100 lines (skills, references, docs) must start with a table of contents right after its title. List each `##` heading as a link, so a reader sees the whole structure in the first lines and can jump to the section it needs. Update the list whenever headings change.
