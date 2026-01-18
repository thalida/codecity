from datetime import datetime, timezone

from codecity.analysis.models import FileMetrics


def test_build_folder_tree_single_file() -> None:
    from codecity.analysis.grid_layout import build_folder_tree

    now = datetime.now(timezone.utc)
    files = [FileMetrics("main.py", 100, 40.0, "python", now, now)]

    root = build_folder_tree(files)

    assert root.name == "root"
    assert root.path == ""
    assert len(root.files) == 1
    assert root.files[0].path == "main.py"
    assert len(root.subfolders) == 0


def test_build_folder_tree_nested_files() -> None:
    from codecity.analysis.grid_layout import build_folder_tree

    now = datetime.now(timezone.utc)
    files = [
        FileMetrics("src/main.py", 100, 40.0, "python", now, now),
        FileMetrics("src/utils.py", 50, 35.0, "python", now, now),
        FileMetrics("tests/test_main.py", 30, 30.0, "python", now, now),
    ]

    root = build_folder_tree(files)

    assert root.name == "root"
    assert len(root.files) == 0
    assert len(root.subfolders) == 2

    src = next(f for f in root.subfolders if f.name == "src")
    assert len(src.files) == 2

    tests = next(f for f in root.subfolders if f.name == "tests")
    assert len(tests.files) == 1
