# CodeCity AI

CodeCity AI is an AI plugin that visualizes codebases as 3D cities. Give an agent a directory and it walks the tree, collects file metadata and git history, then assembles a single self-contained HTML file you can open in any browser. Directories become streets — wide boulevards for large directories, narrow alleys for small ones. Files become buildings whose shape and color encode information: how big the file is, how old it is, when it was last touched, and what language it is written in.

## Quick start

Install as a Claude Code plugin:

```sh
claude plugin add github:thalida/codecity-ai
```

Then either run the slash command or ask naturally:

```text
/codecity
/codecity ./src --depth 3
show me the city for this repo
```

The agent will ask a few clarifying questions (what to scan, how deep, where to save the output), generate the HTML file, and tell you where to open it.

## Building properties

Each file in the tree becomes a building. Visual properties map directly to file data:

| Property   | Data source           | Meaning                                                            |
| ---------- | --------------------- | ------------------------------------------------------------------ |
| Height     | Line count            | Taller = more lines of code                                        |
| Width      | File size (bytes)     | Wider = larger file on disk                                        |
| Depth      | Blend of height/width | `lerp(width, height, 0.5)`                                         |
| Hue        | File extension        | Language family (blue = JS/TS, orange = Python, green = CSS, etc.) |
| Saturation | File age (created)    | Vivid = newer file, faded = older file                             |
| Lightness  | Last modified date    | Bright = recently changed, dim = long untouched                    |

Git timestamps are preferred over filesystem timestamps when the scanned directory is a git repository.

## Configuration

Flags can be passed directly to the invocation:

```text
/codecity ./src --depth 2
/codecity --output ~/Desktop --exclude "*.test.*"
/codecity --no-gitignore --include "*.ts"
```

| Flag                  | Default        | Description                              |
| --------------------- | -------------- | ---------------------------------------- |
| `--root <path>`       | cwd            | Directory to scan                        |
| `--depth <n>`         | unlimited      | Max directory levels                     |
| `--output <path>`     | `~/.codecity/` | Where to write the HTML file             |
| `--exclude <pattern>` | —              | Skip files matching this pattern         |
| `--include <pattern>` | —              | Only include files matching this pattern |
| `--no-gitignore`      | —              | Disable `.gitignore` filtering           |

Color overrides live in `src/defaults.json`. Ask the agent to tweak a hue for a specific extension and it will edit that file.

## Installation on other platforms

### Cursor

Copy or symlink the plugin directory into your Cursor rules folder, then reference `skills/codecity/SKILL.md` from your project's `.cursor/rules`.

### Codex

```sh
ln -s /path/to/codecity-ai ~/.codex/plugins/codecity-ai
```

### OpenCode

Add the plugin path to your OpenCode configuration under the `plugins` key.

### Gemini

Place the plugin directory where Gemini can resolve it as a tool and reference `skills/codecity/SKILL.md` as the skill definition.

## Development

Requirements: `python3 ≥ 3.9` and `git`. Node + vite only for `npm run dev` / `npm run build`.

```bash
npm run dev        # scan cwd, launch vite HMR against src/
npm run build      # rebuild the shipped plugin artifact
npm test           # vitest + script tests + build-drift check
```

Generate an HTML directly without the agent:

```bash
python3 src/codecity.py --root /path/to/project --output out.html
```

## License

[AGPL-3.0](LICENSE)
