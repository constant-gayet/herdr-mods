# herdr-mods

My setup for the [Herdr](https://herdr.dev) desktop app: mods, a layout and key bindings.

| Folder | What it is |
|---|---|
| [`mods/my-prs`](mods/my-prs/README.md) | Your open GitHub PRs and review requests, as a side panel or a popup |
| `mods/my-agents` | The shipped Agents panel, where a finished agent stays unread until you answer it or mark it read |
| `mods/space-folders` | The spaces list with folders (a clone of the shipped `spaces`) |
| `mods/tabs-prs` | The tab bar with a PRs button next to Files and Changes (a clone of the shipped `tabs`) |
| `layouts/main-folders.json` | The layout that puts them together |
| `keys.json` | Key bindings, including the ones these mods use |

## Install

```sh
git clone https://github.com/constant-gayet/herdr-mods ~/work/perso/herdr-mods
~/work/perso/herdr-mods/install.sh
herdr-app do layout.switch '{"name":"main-folders"}'
```

`install.sh` symlinks each mod folder, the layout and `keys.json` into
`~/.config/herdr-app` (or `$HERDR_APP_HOME`). Anything already there is moved to
`~/.config/herdr-app/.herdr-mods-backup/<date>/` first.

**After editing a file here, touch its link so the app reloads it.** The app watches its
own folder, not the folder a link points to, so it doesn't see edits made here:

```sh
touch -h ~/.config/herdr-app/mods/my-agents   # or the layout, or keys.json
```

## my-agents: read when answered

The core turns an agent from `done` into `idle` as soon as its pane is shown, so
passing through an agent (`alt-down`, a click) marks it seen. `my-agents` keeps its
own unread set on top:

- An agent that **finishes while you aren't looking** (`working` → `done`) is unread.
  It stays in **Done** with a filled dot, even after the core calls it `idle`.
- It becomes **read** when it **goes back to working**, which means you answered it,
  or when you mark it read:
  - `alt-r` (`my-agents.toggle-read`) toggles the focused agent. Use it to mark a seen
    agent unread again, too.
  - `alt-shift-r` (`my-agents.read-all`) marks every agent read.
  - Clicking the dot of an unread row marks it read. The ✓ on the **Done** header (in the
    priority view) marks the whole section read.
- An agent that finishes **in front of you** (`working` → `idle` while focused) counts
  as read.
- **Needs you** (`blocked`) is unchanged: it already lasts until the agent moves again.

The unread set is stored in the app's shared state (`my-agents.unread`), so every window
sees the same one and it survives restarts. Only this panel reads it: the dots in the
spaces list and the attention sounds still follow the core's `done` / `idle`.

Cloned from the shipped `agents` mod 0.1.16. Herdr updates don't reach a clone, so new
features of the shipped panel have to be merged in by hand: diff
`~/.config/herdr-app/mods/agents/main.js` against the clone after an update.
