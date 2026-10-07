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

## Adding a mod

Do all five steps every time:

1. Create `mods/<mod>/` with the files shown above.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<mod>"`.
3. Add the mod to `dependencies` in `mods/all/.claude-plugin/plugin.json`.
4. Add a row to the Mods table in `README.md`, its name linking to `mods/<mod>/README.md`, and a link to the list in `mods/all/README.md`.
5. If the mod can be turned on and off, add it to `MODS` in `mods/mod-panel/hooks/mod-panel.tsx`, its value to `mods/mod-panel/types/index.d.ts`, and its name to the list in `mods/mod-panel/README.md`. In the mod, hook `state.set` on `{ plugin: 'mod-panel', key: 'switch' }` and switch itself when the request names it, as `minimal-view` does.

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
