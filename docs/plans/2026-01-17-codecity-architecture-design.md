# CodeCity Architecture Design

## Overview

CodeCity is a 3D city visualization tool for codebases. It renders repositories as interactive cities where files become buildings, folders become streets, and code metrics determine visual properties.

**Target audience:** Individual developers, team leads, and educators exploring, assessing, or teaching about codebases.

## Core Concepts

### City Metaphor

| Code Element | City Element |
|--------------|--------------|
| File | Building |
| Folder | Street |
| Nested folders | Side streets branching from parent |
| Root folder | Main avenue through city center |

### Building Dimensions (File Metrics)

| Dimension | Metric |
|-----------|--------|
| Height | Lines of code |
| Width | Average line length |
| Color hue | File type / language |
| Color saturation | File age (time since creation in git) |
| Color lightness | Last touched (more recent = lighter) |

**Visual interpretation:**
- Old file, recently touched = saturated + light (maintained legacy)
- Old file, untouched = saturated + dark (potential tech debt)
- New file, recently touched = pale + light (fresh code)

## Architecture

### High-Level Components

```
┌─────────────────────────────────────────────────────────┐
│                        CLI                               │
│  codecity serve <repo>  |  codecity build <repo>        │
└─────────────────┬───────────────────┬───────────────────┘
                  │                   │
                  ▼                   ▼
┌─────────────────────────┐  ┌────────────────────────────┐
│     Analysis Engine     │  │      Static Builder        │
│  - Git history parser   │  │  - Bundles viewer + data   │
│  - File stats collector │  │  - Outputs to dist/        │
│  - Metric calculator    │  │                            │
│  - Layout algorithm     │  │                            │
└───────────┬─────────────┘  └────────────────────────────┘
            │
            ▼
┌─────────────────────────┐
│     Web Viewer (SPA)    │
│  - Babylon.js scene     │
│  - Camera/navigation    │
│  - File inspector panel │
│  - Editor integration   │
└─────────────────────────┘
```

### Incremental Updates (Live Reload)

For `serve` mode, the system supports incremental updates when files change or branches switch:

```
┌─────────────────────────────────────────────────────────┐
│                     File Watcher                         │
│  - Watches repo for file changes                         │
│  - Detects branch switches (HEAD change)                 │
│  - Emits change events (added/modified/deleted/branch)   │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                   Diff Calculator                        │
│  - Compares current state to cached state                │
│  - Outputs: files to add, update, remove                 │
│  - On branch switch: full diff against new HEAD          │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Incremental City Updater                    │
│  - Updates only affected buildings                       │
│  - Animates transitions (buildings grow/shrink/appear)   │
│  - Street layout stable unless folders added/removed     │
└───────────────────────┬─────────────────────────────────┘
                        │
                        ▼
                   WebSocket
                        │
                        ▼
┌─────────────────────────────────────────────────────────┐
│                    Web Viewer                            │
│  - Receives incremental updates via WebSocket            │
│  - Morphs scene in place (no full reload)                │
└─────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- File modified → update that building's height/width/color
- File added → animate new building rising from ground
- File deleted → animate building sinking/fading
- Branch switch → diff old vs new, batch update differences

## Data Model

### File Metrics

```python
@dataclass
class FileMetrics:
    path: str                  # relative path from repo root
    lines_of_code: int         # height
    avg_line_length: float     # width
    language: str              # color hue (detected from extension)
    created_at: datetime       # color saturation (first commit)
    last_modified: datetime    # color lightness (most recent commit)

@dataclass
class FolderNode:
    path: str
    children: list[FolderNode | FileMetrics]
```

### Git History Extraction

- Use `git log --format` and `git diff --numstat` for efficiency
- Cache results keyed by commit SHA
- On incremental update: only query history for changed files

### Language Detection

- Simple extension mapping (`.py` → Python, `.ts` → TypeScript, etc.)
- No AST parsing needed since we're file-level only
- Configurable color palette per language in settings

## Caching

### Cache Locations

```
Default cache locations (per OS):
├── macOS:   ~/Library/Caches/codecity/<repo-hash>/
├── Linux:   ~/.cache/codecity/<repo-hash>/      (XDG_CACHE_HOME)
└── Windows: %LOCALAPPDATA%\codecity\cache\<repo-hash>/

CLI override:
  codecity serve . --cache-dir /path/to/custom/cache
  codecity build . --cache-dir /path/to/custom/cache
```

### Cache Structure

```
<cache-dir>/<repo-hash>/
├── analysis.json      # file metrics
├── git-history.json   # commit data
└── layout.json        # computed city layout
```

- Use `platformdirs` library for OS-appropriate defaults
- `<repo-hash>` = short hash of repo's absolute path (avoids collisions)
- Cache keyed by: `{file_path}:{last_commit_sha}`
- Full cache invalidation only on branch switch with significant divergence

## City Layout Algorithm

### Street Network

```
src/
├── codecity/
│   ├── client/
│   │   └── client.py
│   ├── cli.py
│   └── types.py
└── tests/
    └── test_cli.py

Becomes:

          ┌─────────────────────────────────────────┐
          │              Main Avenue                │
          │                (src/)                   │
          ├───────────────────┬─────────────────────┤
          │                   │                     │
    ┌─────┴─────┐       ┌─────┴─────┐              │
    │ codecity/ │       │  tests/   │              │
    │   Street  │       │  Street   │              │
    │           │       │           │              │
    │ ┌───┐┌───┐│       │  ┌───┐    │              │
    │ │cli││typ││       │  │tst│    │              │
    │ └───┘└───┘│       │  └───┘    │              │
    │     │     │       │           │              │
    │  ┌──┴──┐  │       └───────────┘              │
    │  │client│ │                                  │
    │  │ Lane │ │                                  │
    │  │┌────┐│ │                                  │
    │  ││cli ││ │                                  │
    │  │└────┘│ │                                  │
    │  └──────┘ │                                  │
    └───────────┘                                  │
```

### Layout Rules

- Root folder = main avenue running through city center
- Each subfolder = side street branching off parent
- Files = buildings lining their folder's street
- Deeper nesting = further from center (like suburbs)
- Street width proportional to total files within that subtree

### Building Placement

- Buildings placed along street edges, facing the street
- Spacing based on building footprint + small gap
- Taller buildings cast shadows (Babylon.js shadow generator)

## Web Viewer

### Scene Components

```
Scene Components:
├── Ground plane (subtle grid texture)
├── Streets (flat geometry with road texture)
├── Buildings (box meshes with computed dimensions)
├── Skybox (subtle gradient or solid color)
├── Lighting
│   ├── Hemisphere light (ambient)
│   └── Directional light (sun, casts shadows)
└── Camera (ArcRotate - orbit around city center)
```

### Building Rendering

- Each file = `BABYLON.MeshBuilder.CreateBox()`
- Dimensions: `{ height: loc, width: avgLineLen, depth: avgLineLen }`
- Material: `PBRMaterial` with HSL color mapped to metrics
- Metadata attached to mesh for inspector panel

### Camera & Navigation

- ArcRotate camera (orbit, zoom, pan)
- Double-click building to focus/zoom to it
- Keyboard shortcuts: `R` reset view, `F` focus selected
- Optional: WASD first-person mode for "walking" the city

### Inspector Panel (HTML Overlay)

- Shows on hover/click: file name, path, all metrics
- "Open in Editor" button
- "View on GitHub" button (if remote detected)
- Mini line-count history sparkline (nice-to-have)

## Editor Integration

### Configuration

Config file location: `~/.config/codecity/config.toml` (or OS equivalent)

```toml
[editor]
# Supported: "vscode", "cursor", "idea", "webstorm", "vim", "custom"
name = "vscode"

# Or define custom command (overrides name)
# {file} and {line} are replaced at runtime
custom_command = "code --goto {file}:{line}"
```

### Built-in Editor Support

| Editor    | URL Scheme / Command                          |
|-----------|-----------------------------------------------|
| VS Code   | `vscode://file/{path}:{line}`                 |
| Cursor    | `cursor://file/{path}:{line}`                 |
| JetBrains | `jetbrains://{product}/navigate/reference?path={path}&line={line}` |
| Vim/Neovim| Falls back to CLI: `nvim +{line} {path}` via terminal |
| Custom    | User-defined command template                 |

### GitHub/GitLab Integration

- Auto-detect remote from `git remote -v`
- Parse GitHub/GitLab/Bitbucket URLs
- "View on remote" link: `https://github.com/{owner}/{repo}/blob/{branch}/{path}`

### Click Behavior

- Single click = select building, show inspector
- Double click = open file in configured editor
- Right-click = context menu (open, view on remote, copy path)

## Configuration System

### Config Resolution Order (Later Wins)

1. Default location (`~/.config/codecity/config.toml`)
2. Custom location via `--config` flag
3. CLI arguments (override any config value)

### CLI Usage

```bash
# Use custom config location
codecity serve . --config /path/to/config.toml

# Override specific values
codecity serve . --editor cursor --cache-dir /tmp/cc

# Config management commands
codecity config get editor.name
codecity config set editor.name cursor
codecity config list
codecity config path                    # show active config location
codecity config init                    # create default config file
codecity config init --path ./custom    # create at custom location
```

### Environment Variable Support

```bash
CODECITY_CONFIG=/path/to/config.toml
CODECITY_EDITOR=vscode
CODECITY_CACHE_DIR=/tmp/cache
```

**Precedence:** CLI args > env vars > config file > defaults

## CLI Commands

### Core Commands

```bash
codecity serve <repo> [options]     # Live server with hot reload
codecity build <repo> [options]     # Generate static site to --out-dir
```

### Config Commands

```bash
codecity config get <key>
codecity config set <key> <value>
codecity config list
codecity config path
codecity config init [--path]
```

### Common Options (serve & build)

```
--config <path>         Config file location
--cache-dir <path>      Cache directory
--editor <name>         Editor for "open" integration
--port <number>         Port for serve (default: 3000)
--out-dir <path>        Output directory for build (default: ./codecity-dist)
--open                  Open browser automatically (serve only)
```

## Tech Stack

| Layer         | Technology                              |
|---------------|-----------------------------------------|
| CLI           | Python + rich-click                     |
| Analysis      | GitPython or subprocess git commands    |
| Web server    | FastAPI + uvicorn (serve mode)          |
| WebSocket     | FastAPI WebSocket for live updates      |
| Frontend      | Vanilla JS + Babylon.js                 |
| Bundler       | Vite (for build mode)                   |
| Config        | Pydantic Settings                       |
| Cache         | JSON files + platformdirs               |

## Project Structure

```
src/codecity/
├── __init__.py
├── types.py
├── conftest.py
├── cli/
│   ├── __init__.py
│   ├── commands.py               # serve, build, config commands
│   └── tests/
│       └── test_commands.py
├── config/
│   ├── __init__.py
│   ├── settings.py
│   ├── defaults.py
│   └── tests/
│       └── test_settings.py
├── analysis/
│   ├── __init__.py
│   ├── git.py
│   ├── metrics.py
│   ├── cache.py
│   ├── layout.py
│   ├── diff.py
│   ├── models.py
│   └── tests/
│       ├── test_git.py
│       ├── test_metrics.py
│       ├── test_cache.py
│       ├── test_layout.py
│       └── test_diff.py
├── api/
│   ├── __init__.py
│   ├── app.py
│   ├── watcher.py
│   ├── websocket.py
│   └── tests/
│       ├── test_app.py
│       └── test_websocket.py
└── app/
    ├── __init__.py
    ├── builder.py
    ├── index.html
    ├── main.js
    ├── city-renderer.js
    ├── inspector.js
    ├── styles.css
    └── tests/
        └── test_builder.py
```
