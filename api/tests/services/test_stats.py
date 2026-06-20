from api.services.stats import compute_repo_stats


def _file(
    path,
    *,
    lines=10,
    size=100,
    created="2020-01-01T00:00:00Z",
    modified="2020-01-01T00:00:00Z",
    binary=False,
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
        "created": created,
        "modified": modified,
    }
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

    assert s["tallestFile"]["path"] == "a.ts"
    assert s["shortestFile"]["path"] == "a.ts"  # only a.ts is text with lines>0
    assert s["widestFile"]["path"] == "a.ts"
    assert s["narrowestFile"]["path"] == "__init__.py"
    assert s["largestMedia"]["path"] == "pic.png"
    assert s["sharpestMedia"]["path"] == "pic.png"
    assert s["sharpestMedia"]["media_width"] == 1920
    assert s["oldestFile"]["path"] == "__init__.py"
    assert s["newestFile"]["path"] == "a.ts"
    assert s["freshestFile"]["path"] == "a.ts"
    assert s["stalestFile"]["path"] == "__init__.py"
    assert s["fileLines"] == {"min": 40, "max": 40}
    assert s["fileBytes"]["max"] == 400
    assert s["mediaCount"] == 1


def test_dir_leaders_exclude_root():
    deep = _dir("b", "src/a/b", [_file("src/a/b/x.ts")])
    src = _dir("src", "src", [deep, _file("src/m.ts")])
    src["descendants_file_count"] = 5
    tree = _dir("repo", "", [src, _file("r.ts")])
    s = compute_repo_stats(tree, [])
    assert s["deepestDir"]["path"] == "src/a/b"
    assert s["biggestDir"]["path"] == "src"


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
    assert s["grandestCommit"] == {"sha": "bbb", "files": 40}
    assert s["sparsestCommit"] == {"sha": "ccc", "files": 1}
    assert s["busiestDay"]["count"] == 2
    assert s["longestStreakDays"] == 3
    assert s["authors"][0] == {"name": "Ada", "commits": 3}
    assert [a["name"] for a in s["authors"]] == ["Ada", "Bo"]


def test_empty_tree_and_no_commits():
    s = compute_repo_stats(_dir("repo", "", []), [])
    assert s["tallestFile"] is None
    assert s["grandestCommit"] is None
    assert s["longestStreakDays"] == 0
    assert s["authors"] == []
    assert s["fileLines"] == {"min": 0, "max": 0}
    assert s["mediaCount"] == 0
