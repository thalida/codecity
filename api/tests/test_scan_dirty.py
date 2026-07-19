# api/tests/test_scan_dirty.py
from api.services.scan import _parse_dirty_paths


def test_parse_dirty_paths_reads_modified_and_staged_skips_untracked():
    # git status --porcelain -z format: "XY <path>\0", renames "R  <new>\0<old>\0".
    z = (
        "\0".join(
            [
                " M api/services/scan.py",  # unstaged modification
                "A  api/new_staged.py",  # staged addition
                "?? scratch.txt",  # untracked -> excluded
                "!! build/artifact",  # ignored -> excluded
            ]
        )
        + "\0"
    )
    assert _parse_dirty_paths(z) == {"api/services/scan.py", "api/new_staged.py"}


def test_parse_dirty_paths_rename_takes_destination():
    z = "R  api/renamed_to.py\0api/renamed_from.py\0"
    assert _parse_dirty_paths(z) == {"api/renamed_to.py"}


def test_parse_dirty_paths_empty():
    assert _parse_dirty_paths("") == set()
