"""Grid-based city layout with connected streets."""

from dataclasses import dataclass, field
from pathlib import PurePosixPath

from codecity.analysis.models import FileMetrics


@dataclass
class Folder:
    """A folder in the file tree."""

    name: str
    path: str
    files: list[FileMetrics] = field(default_factory=list)
    subfolders: list["Folder"] = field(default_factory=list)


def build_folder_tree(files: list[FileMetrics]) -> Folder:
    """Build a folder tree from a list of file metrics."""
    root = Folder(name="root", path="")

    for file_metrics in files:
        path = PurePosixPath(file_metrics.path)
        parts = path.parts

        current = root
        # Navigate/create folders for each directory in the path
        for i, part in enumerate(parts[:-1]):
            folder_path = "/".join(parts[: i + 1])
            existing = next(
                (f for f in current.subfolders if f.name == part),
                None,
            )

            if existing:
                current = existing
            else:
                new_folder = Folder(name=part, path=folder_path)
                current.subfolders.append(new_folder)
                current = new_folder

        # Add file to the final folder
        current.files.append(file_metrics)

    return root
