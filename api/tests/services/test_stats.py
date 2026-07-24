from api.services.stats import compute_repo_stats


def _file(
    path,
    *,
    lines=10,
    size=100,
    created="2020-01-01T00:00:00Z",
    modified="2020-01-01T00:00:00Z",
    binary=False,
    dirty=False,
    media=None,
    mw=None,
    mh=None,
):
    n = {
        "name": path.split("/")[-1],
        "type": "file",
        "path": path,
        "fullPath": "/" + path,
        "extension": "." + path.split(".")[-1] if "." in path else "",
        "mediaKind": media,
        "size": size,
        "lines": lines,
        "binary": binary,
        "dirty": dirty,
        "created": created,
        "modified": modified,
    }
    assert (mw is None) == (mh is None), "supply both mw and mh or neither"
    if mw is not None:
        n["media_width"], n["media_height"] = mw, mh
    return n


def _dir(name, path, children):
    files = [c for c in children if c["type"] == "file"]
    return {
        "name": name,
        "type": "directory",
        "path": path,
        "fullPath": "/" + path,
        "children": children,
        "children_count": len(children),
        "children_file_count": len(files),
        "children_dir_count": len(children) - len(files),
        "descendants_count": len(children),
        "descendants_file_count": len(files),
        "descendants_dir_count": len(children) - len(files),
        "descendants_size": 0,
        "descendants_ext_breakdown": [],
    }


def test_file_leaders_partition_media_and_text():
    code = _file(
        "a.ts",
        lines=40,
        size=400,
        created="2021-01-01T00:00:00Z",
        modified="2022-01-01T00:00:00Z",
    )
    empty = _file(
        "__init__.py",
        lines=0,
        size=0,
        created="2020-01-01T00:00:00Z",
        modified="2020-06-01T00:00:00Z",
    )
    img = _file("pic.png", lines=0, size=9000, media="image", mw=1920, mh=1080)
    tree = _dir("repo", "", [code, empty, img])
    s = compute_repo_stats(tree, [])

    assert s["maxLinesFile"]["path"] == "a.ts"
    assert s["minLinesFile"]["path"] == "a.ts"  # only a.ts is text with lines>0
    assert s["maxBytesFile"]["path"] == "a.ts"
    assert s["minBytesFile"]["path"] == "__init__.py"
    assert s["maxMediaBytesFile"]["path"] == "pic.png"
    assert s["maxMediaPixelsFile"]["path"] == "pic.png"
    assert s["maxMediaPixelsFile"]["media_width"] == 1920
    assert s["oldestCreatedFile"]["path"] == "__init__.py"
    assert s["newestCreatedFile"]["path"] == "a.ts"
    assert s["newestModifiedFile"]["path"] == "a.ts"
    assert s["oldestModifiedFile"]["path"] == "__init__.py"
    # Ranges span ALL files with non-zero values (media included for bytes); the
    # 0-line/0-byte __init__.py is excluded from both.
    assert s["lineCountRange"] == {"min": 40, "max": 40}  # only a.ts has lines>0
    assert s["byteSizeRange"] == {"min": 400, "max": 9000}  # a.ts .. pic.png(media)
    assert s["mediaCount"] == 1
    # Sums are over non-media files only (a.ts + __init__.py; pic.png excluded).
    assert s["totalLines"] == 40
    assert s["codeBytes"] == 400


def test_binaries_are_their_own_category_not_code_superlatives():
    # A giant binary must NOT win "widest building": binaries are partitioned
    # into their own data category (like media), with their own size leaders.
    code = _file("a.ts", lines=40, size=400)
    db = _file("data.db", lines=0, size=50_000, binary=True)
    small_bin = _file("tiny.wasm", lines=0, size=800, binary=True)
    tree = _dir("repo", "", [code, db, small_bin])
    s = compute_repo_stats(tree, [])

    # Code superlatives ignore binaries entirely.
    assert s["maxBytesFile"]["path"] == "a.ts"  # not data.db, despite 50 KB
    assert s["minBytesFile"]["path"] == "a.ts"
    assert s["maxLinesFile"]["path"] == "a.ts"
    # Binaries get their own count + byte leaders.
    assert s["binaryCount"] == 2
    assert s["maxBinaryBytesFile"]["path"] == "data.db"
    assert s["minBinaryBytesFile"]["path"] == "tiny.wasm"
    # Binary bytes are excluded from the code overview average.
    assert s["codeBytes"] == 400
    # ...but binaries still count toward the world-wide byte NORMALIZATION range
    # (they render as byte-sized buildings, so their size must scale the range).
    assert s["byteSizeRange"] == {"min": 400, "max": 50_000}


def test_dir_leaders_exclude_root():
    deep = _dir("b", "src/a/b", [_file("src/a/b/x.ts")])  # 1 direct child
    src = _dir("src", "src", [deep, _file("src/m.ts")])  # 2 direct children
    tree = _dir("repo", "", [src, _file("r.ts")])
    s = compute_repo_stats(tree, [])
    assert s["maxDepthDir"]["path"] == "src/a/b"  # most nested
    assert s["maxChildrenDir"]["path"] == "src"  # most direct children (2)
    assert s["maxChildrenDir"]["children"] == 2
    assert s["minChildrenDir"]["path"] == "src/a/b"  # fewest direct children (1)


def test_commit_leaders_authors_and_streak():
    commits = [
        {
            "date": "2022-01-01",
            "files": 2,
            "sha": "aaa",
            "authors": ["Ada"],
            "subject": "a",
            "same_day_total": 1,
        },
        {
            "date": "2022-01-02",
            "files": 40,
            "sha": "bbb",
            "authors": ["Ada", "Bo"],
            "subject": "b",
            "same_day_total": 2,
        },
        {
            "date": "2022-01-03",
            "files": 1,
            "sha": "ccc",
            "authors": ["Bo"],
            "subject": "c",
            "same_day_total": 2,
        },
        {
            "date": "2022-02-10",
            "files": 5,
            "sha": "ddd",
            "authors": ["Ada"],
            "subject": "d",
            "same_day_total": 1,
        },
    ]
    s = compute_repo_stats(_dir("repo", "", [_file("a.ts")]), commits)
    assert s["maxFilesPerCommit"] == {"sha": "bbb", "files": 40}
    assert s["minFilesPerCommit"] == {"sha": "ccc", "files": 1}
    assert s["commitDates"] == {"oldest": "2022-01-01", "newest": "2022-02-10"}
    assert s["maxCommitsPerDay"]["count"] == 2
    assert s["maxCommitStreakDays"] == 3
    assert s["authors"][0] == {"name": "Ada", "commits": 3}
    assert [a["name"] for a in s["authors"]] == ["Ada", "Bo"]


def test_empty_tree_and_no_commits():
    s = compute_repo_stats(_dir("repo", "", []), [])
    assert s["maxLinesFile"] is None
    assert s["maxFilesPerCommit"] is None
    assert s["maxCommitStreakDays"] == 0
    assert s["authors"] == []
    assert s["commitDates"] == {"oldest": None, "newest": None}
    assert s["lineCountRange"] == {"min": 0, "max": 0}
    assert s["mediaCount"] == 0


def test_ranges_span_all_files_excluding_zero():
    # The byte range must include the media file and exclude the 0-byte file —
    # this matches the old client computeFileStats so building widths are
    # identical. The 0-byte file excluded means the frontend never sees log(0).
    code = _file("a.ts", lines=10, size=200)
    big = _file("big.png", lines=0, size=9000, media="image", mw=4, mh=4)
    empty = _file("empty.py", lines=0, size=0)
    s = compute_repo_stats(_dir("repo", "", [code, big, empty]), [])
    assert s["lineCountRange"] == {"min": 10, "max": 10}  # only a.ts has lines>0
    assert s["byteSizeRange"] == {
        "min": 200,
        "max": 9000,
    }  # a.ts + media; empty excluded


def test_media_only_repo_ranges():
    # A repo of only media files: no lines>0 → empty line range; media bytes
    # still drive the byte range so media buildings size correctly.
    img = _file("a.png", lines=0, size=500, media="image", mw=10, mh=10)
    s = compute_repo_stats(_dir("repo", "", [img]), [])
    assert s["lineCountRange"] == {"min": 0, "max": 0}
    assert s["byteSizeRange"] == {"min": 500, "max": 500}


def test_media_min_max_leaders():
    small = _file("small.png", lines=0, size=100, media="image", mw=10, mh=10)
    big = _file("big.png", lines=0, size=9000, media="image", mw=1920, mh=1080)
    s = compute_repo_stats(_dir("repo", "", [small, big]), [])
    assert s["maxMediaBytesFile"]["path"] == "big.png"
    assert s["minMediaBytesFile"]["path"] == "small.png"
    assert s["maxMediaPixelsFile"]["path"] == "big.png"
    assert s["minMediaPixelsFile"]["path"] == "small.png"


def test_empty_files_only_ranges():
    # A repo of only empty files: both ranges are the {0,0} sentinel; the
    # frontend's _safeRange turns these into {1,1} (no divide-by-zero).
    empty = _file("__init__.py", lines=0, size=0)
    s = compute_repo_stats(_dir("repo", "", [empty]), [])
    assert s["lineCountRange"] == {"min": 0, "max": 0}
    assert s["byteSizeRange"] == {"min": 0, "max": 0}
