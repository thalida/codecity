from typing import Literal

EditorType = Literal["vscode", "cursor", "idea", "webstorm", "vim", "custom"]

EDITOR_URL_TEMPLATES: dict[str, str] = {
    "vscode": "vscode://file/{file}:{line}",
    "cursor": "cursor://file/{file}:{line}",
    "idea": "jetbrains://idea/navigate/reference?path={file}&line={line}",
    "webstorm": "jetbrains://webstorm/navigate/reference?path={file}&line={line}",
    "vim": "nvim +{line} {file}",
}

# Hue values (0-360) for HSL color mapping
LANGUAGE_COLORS: dict[str, int] = {
    "python": 210,  # Blue
    "javascript": 50,  # Yellow
    "typescript": 200,  # Light blue
    "java": 30,  # Orange
    "go": 180,  # Cyan
    "rust": 15,  # Red-orange
    "ruby": 0,  # Red
    "php": 260,  # Purple
    "c": 220,  # Steel blue
    "cpp": 220,  # Steel blue
    "csharp": 270,  # Violet
    "swift": 25,  # Orange
    "kotlin": 280,  # Purple
    "scala": 0,  # Red
    "html": 15,  # Orange-red
    "css": 200,  # Light blue
    "scss": 330,  # Pink
    "json": 45,  # Gold
    "yaml": 120,  # Green
    "markdown": 150,  # Teal
    "shell": 100,  # Yellow-green
    "sql": 190,  # Cyan
    "unknown": 0,  # Gray (will use low saturation)
}

EXTENSION_TO_LANGUAGE: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".mjs": "javascript",
    ".cjs": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".jsx": "javascript",
    ".java": "java",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby",
    ".php": "php",
    ".c": "c",
    ".h": "c",
    ".cpp": "cpp",
    ".hpp": "cpp",
    ".cc": "cpp",
    ".cs": "csharp",
    ".swift": "swift",
    ".kt": "kotlin",
    ".scala": "scala",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".sass": "scss",
    ".json": "json",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".md": "markdown",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".sql": "sql",
}


def get_editor_url(
    editor: EditorType,
    file_path: str,
    line: int = 1,
    custom_command: str | None = None,
) -> str:
    if editor == "custom":
        if not custom_command:
            raise ValueError("custom_command is required when editor is 'custom'")
        template = custom_command
    else:
        template = EDITOR_URL_TEMPLATES.get(editor, EDITOR_URL_TEMPLATES["vscode"])

    return template.format(file=file_path, line=line)


def get_language_from_extension(extension: str) -> str:
    return EXTENSION_TO_LANGUAGE.get(extension.lower(), "unknown")


def get_language_hue(language: str) -> int:
    return LANGUAGE_COLORS.get(language.lower(), LANGUAGE_COLORS["unknown"])


# Muted earthy tones for district ground colors (RGB 0-255)
DISTRICT_COLORS: list[tuple[int, int, int]] = [
    (89, 98, 117),  # slate blue
    (117, 98, 89),  # warm brown
    (89, 117, 98),  # sage green
    (107, 89, 117),  # muted purple
    (117, 107, 89),  # tan
    (89, 107, 117),  # steel blue
]


def get_district_color(index: int, depth: int = 0) -> tuple[int, int, int]:
    """Get district color by index, cycling through palette. Deeper = lighter."""
    base = DISTRICT_COLORS[index % len(DISTRICT_COLORS)]
    # Lighten by 15 per depth level, max 40
    lighten = min(depth * 15, 40)
    return (
        min(base[0] + lighten, 255),
        min(base[1] + lighten, 255),
        min(base[2] + lighten, 255),
    )
