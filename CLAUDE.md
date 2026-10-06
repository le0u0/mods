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
```

## Adding a mod

Do all four steps every time:

1. Create `mods/<mod>/` with the files shown above.
2. Add an entry to `.claude-plugin/marketplace.json` with `"source": "./mods/<mod>"`.
3. Add the mod to `dependencies` in `mods/all/.claude-plugin/plugin.json`.
4. Add a row to the Mods table in `README.md`.

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

`README.md` is for users only: what each mod does and how to install it. Keep it short. Do not add development notes or steps the install UI already shows.

## Long Markdown files

Any `.md` file in this repo over 100 lines (skills, references, docs) must start with a table of contents right after its title. List each `##` heading as a link, so a reader sees the whole structure in the first lines and can jump to the section it needs. Update the list whenever headings change.
