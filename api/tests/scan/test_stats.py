import pytest

from api.models.manifest import (
    AuthorStat,
    BusynessThresholds,
    CommitLeader,
    RangeStat,
)
from api.tests.conftest import make_commit, make_dir_node, make_file_node
from api.scan.stats import (
    _author_hue,
    annotate_same_day_totals,
    busyness_thresholds,
    commit_day_counts,
    compute_repo_stats,
)


def _file(path, *, media=None, mw=None, mh=None, **kw):
    """FileNode fixture. `media`/`mw`/`mh` keep the call sites below readable;
    everything else passes straight through to the shared builder."""
    assert (mw is None) == (mh is None), "supply both mw and mh or neither"
    return make_file_node(path, mediaKind=media, media_width=mw, media_height=mh, **kw)


def _dir(name, path, children, created=None, modified=None):
    return make_dir_node(
        path,
        children,
        name=name,
        descendants_size=0,
        descendants_created_min=created,
        descendants_modified_max=modified,
    )


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

    assert s.maxLinesFile.path == "a.ts"
    assert s.minLinesFile.path == "a.ts"  # only a.ts is text with lines>0
    assert s.maxBytesFile.path == "a.ts"
    assert s.minBytesFile.path == "__init__.py"
    assert s.maxMediaBytesFile.path == "pic.png"
    assert s.maxMediaPixelsFile.path == "pic.png"
    assert s.maxMediaPixelsFile.media_width == 1920
    assert s.oldestCreatedFile.path == "__init__.py"
    assert s.newestCreatedFile.path == "a.ts"
    assert s.newestModifiedFile.path == "a.ts"
    assert s.oldestModifiedFile.path == "__init__.py"
    # Ranges span ALL files with non-zero values (media included for bytes); the
    # 0-line/0-byte __init__.py is excluded from both.
    assert s.lineCountRange == RangeStat(min=40, max=40)  # only a.ts has lines>0
    assert s.byteSizeRange == RangeStat(min=400, max=9000)  # a.ts .. pic.png(media)
    assert s.mediaCount == 1
    # Sums are over non-media files only (a.ts + __init__.py; pic.png excluded).
    assert s.totalLines == 40
    assert s.codeBytes == 400


def test_binaries_are_their_own_category_not_code_superlatives():
    # A giant binary must NOT win "widest building": binaries are partitioned
    # into their own data category (like media), with their own size leaders.
    code = _file("a.ts", lines=40, size=400)
    db = _file("data.db", lines=0, size=50_000, binary=True)
    small_bin = _file("tiny.wasm", lines=0, size=800, binary=True)
    tree = _dir("repo", "", [code, db, small_bin])
    s = compute_repo_stats(tree, [])

    # Code superlatives ignore binaries entirely.
    assert s.maxBytesFile.path == "a.ts"  # not data.db, despite 50 KB
    assert s.minBytesFile.path == "a.ts"
    assert s.maxLinesFile.path == "a.ts"
    # Binaries get their own count + byte leaders.
    assert s.binaryCount == 2
    assert s.maxBinaryBytesFile.path == "data.db"
    assert s.minBinaryBytesFile.path == "tiny.wasm"
    # Binary bytes are excluded from the code overview average.
    assert s.codeBytes == 400
    # ...but binaries still count toward the world-wide byte NORMALIZATION range
    # (they render as byte-sized buildings, so their size must scale the range).
    assert s.byteSizeRange == RangeStat(min=400, max=50_000)


def test_dir_leaders_exclude_root():
    deep = _dir("b", "src/a/b", [_file("src/a/b/x.ts")])  # 1 direct child
    src = _dir("src", "src", [deep, _file("src/m.ts")])  # 2 direct children
    tree = _dir("repo", "", [src, _file("r.ts")])
    s = compute_repo_stats(tree, [])
    assert s.maxDepthDir.path == "src/a/b"  # most nested
    assert s.maxChildrenDir.path == "src"  # most direct children (2)
    assert s.maxChildrenDir.children == 2
    assert s.minChildrenDir.path == "src/a/b"  # fewest direct children (1)


def test_street_age_leaders_take_the_subtree_dates():
    # A street's age is its subtree's: oldest file created under it, newest
    # change anywhere in it.
    old = _dir("old", "src/old", [_file("src/old/x.ts")], created="2019-01-01")
    new = _dir("new", "src/new", [_file("src/new/y.ts")], created="2024-06-01")
    src = _dir("src", "src", [old, new], created="2019-01-01", modified="2024-06-02")
    tree = _dir("repo", "", [src], created="2019-01-01", modified="2024-06-02")
    s = compute_repo_stats(tree, [])
    assert s.oldestCreatedDir.path == "src/old"
    assert s.oldestCreatedDir.created == "2019-01-01"
    assert s.newestCreatedDir.path == "src/new"
    assert s.newestCreatedDir.created == "2024-06-01"


def test_street_age_leaders_skip_undated_dirs():
    # A directory with no dated descendants can't win either end, and a tree of
    # nothing but those leaves both empty rather than picking arbitrarily.
    bare = _dir("bare", "src/bare", [])
    tree = _dir("repo", "", [bare])
    s = compute_repo_stats(tree, [])
    assert s.oldestCreatedDir is None
    assert s.newestCreatedDir is None


def test_commit_leaders_authors_and_streak():
    commits = [
        make_commit(
            "aaa",
            date="2022-01-01",
            files=2,
            authors=["Ada"],
            subject="a",
            same_day_total=1,
        ),
        make_commit(
            "bbb",
            date="2022-01-02",
            files=40,
            authors=["Ada", "Bo"],
            subject="b",
            same_day_total=2,
        ),
        make_commit(
            "ccc",
            date="2022-01-03",
            files=1,
            authors=["Bo"],
            subject="c",
            same_day_total=2,
        ),
        make_commit(
            "ddd",
            date="2022-02-10",
            files=5,
            authors=["Ada"],
            subject="d",
            same_day_total=1,
        ),
    ]
    s = compute_repo_stats(_dir("repo", "", [_file("a.ts")]), commits)
    assert s.maxFilesPerCommit == CommitLeader(sha="bbb", files=40, date="2022-01-02")
    # The history's ends carry their sha, so the almanac can fly the camera to
    # the tree rather than only naming a date.
    assert s.oldestCommit.sha == "aaa"
    assert s.oldestCommit.date == "2022-01-01"
    assert s.newestCommit.sha == "ddd"
    assert s.newestCommit.date == "2022-02-10"
    assert s.minFilesPerCommit == CommitLeader(sha="ccc", files=1, date="2022-01-03")
    assert s.maxCommitsPerDay.count == 2
    assert s.maxCommitStreakDays == 3
    assert s.authors[0] == AuthorStat(name="Ada", commits=3, hue=_author_hue("Ada"))
    assert [a.name for a in s.authors] == ["Ada", "Bo"]


def test_newest_commit_is_the_last_one_that_day():
    """Several commits share the newest day, which is a normal working day. The
    leader must be the LAST of them: comparing truncated dates kept the first,
    so the almanac named a commit two behind HEAD."""
    same_day = [
        make_commit(
            sha,
            date=f"2026-08-15T0{i}:00:00Z",
            authors=["Ada"],
            subject=sha,
            same_day_total=3,
        )
        for i, sha in enumerate(["aaa", "bbb", "ccc"])
    ]
    s = compute_repo_stats(_dir("repo", "", [_file("a.ts")]), same_day)

    assert s.newestCommit.sha == "ccc"
    assert s.oldestCommit.sha == "aaa"


def test_empty_tree_and_no_commits():
    s = compute_repo_stats(_dir("repo", "", []), [])
    assert s.maxLinesFile is None
    assert s.maxFilesPerCommit is None
    assert s.maxCommitStreakDays == 0
    assert s.authors == []
    assert s.lineCountRange == RangeStat(min=0, max=0)
    assert s.mediaCount == 0


def test_ranges_span_all_files_excluding_zero():
    # Matches the client's computeFileStats, so building widths agree. The
    # 0-byte file is excluded so the frontend never sees log(0).
    code = _file("a.ts", lines=10, size=200)
    big = _file("big.png", lines=0, size=9000, media="image", mw=4, mh=4)
    empty = _file("empty.py", lines=0, size=0)
    s = compute_repo_stats(_dir("repo", "", [code, big, empty]), [])
    assert s.lineCountRange == RangeStat(min=10, max=10)  # only a.ts has lines>0
    # a.ts + media; empty excluded
    assert s.byteSizeRange == RangeStat(min=200, max=9000)


def test_media_only_repo_ranges():
    # A repo of only media files: no lines>0 → empty line range; media bytes
    # still drive the byte range so media buildings size correctly.
    img = _file("a.png", lines=0, size=500, media="image", mw=10, mh=10)
    s = compute_repo_stats(_dir("repo", "", [img]), [])
    assert s.lineCountRange == RangeStat(min=0, max=0)
    assert s.byteSizeRange == RangeStat(min=500, max=500)


def test_media_min_max_leaders():
    small = _file("small.png", lines=0, size=100, media="image", mw=10, mh=10)
    big = _file("big.png", lines=0, size=9000, media="image", mw=1920, mh=1080)
    s = compute_repo_stats(_dir("repo", "", [small, big]), [])
    assert s.maxMediaBytesFile.path == "big.png"
    assert s.minMediaBytesFile.path == "small.png"
    assert s.maxMediaPixelsFile.path == "big.png"
    assert s.minMediaPixelsFile.path == "small.png"


def test_empty_files_only_ranges():
    # A repo of only empty files: both ranges are the {0,0} sentinel; the
    # frontend's _safeRange turns these into {1,1} (no divide-by-zero).
    empty = _file("__init__.py", lines=0, size=0)
    s = compute_repo_stats(_dir("repo", "", [empty]), [])
    assert s.lineCountRange == RangeStat(min=0, max=0)
    assert s.byteSizeRange == RangeStat(min=0, max=0)


def test_author_hue_matches_the_javascript_hash_it_replaced():
    """Golden values from the original client-side FNV-1a, so moving the hash
    to Python can't silently recolor everyone's orbs."""
    assert _author_hue("Alice") == 143
    assert _author_hue("Bob") == 220
    assert _author_hue("") == 61
    # Unicode hashes over UTF-8 bytes, not UTF-16 code units.
    assert _author_hue("Yan \U0001f680 M\u00fcller") == 181
    assert all(0 <= _author_hue(f"user-{i}") < 360 for i in range(200))


def _commits_per_day(*per_day: int) -> list:
    """Commits spread over consecutive dates, `per_day[i]` of them on day i."""
    return [
        make_commit(date=f"2026-01-{day:02d}")
        for day, n in enumerate(per_day, start=1)
        for _ in range(n)
    ]


@pytest.mark.parametrize(
    ("per_day", "expected"),
    [
        ((), BusynessThresholds(avg=1, busy=1)),
        # Sorted per-day counts [1,1,2,5]: avg is the median 2, busy the 75th
        # percentile 5.
        ((1, 1, 2, 5), BusynessThresholds(avg=2, busy=5)),
        # Uniform: median and 75th both 2, so busy clamps to avg + 1.
        ((2, 2, 2, 2), BusynessThresholds(avg=2, busy=3)),
    ],
)
def test_busyness_thresholds(per_day, expected):
    assert (
        busyness_thresholds(commit_day_counts(_commits_per_day(*per_day))) == expected
    )


@pytest.mark.parametrize(
    ("dates", "expected"),
    [
        ([], []),
        (["2026-01-01"] * 3 + ["2026-01-02"], [3, 3, 3, 1]),
        (["2026-01-01", "2026-01-02", "2026-01-01"], [2, 1, 2]),
    ],
)
def test_annotate_same_day_totals(dates, expected):
    commits = [make_commit(str(i) * 40, date=d) for i, d in enumerate(dates)]
    annotate_same_day_totals(commits, commit_day_counts(commits))
    assert [c.same_day_total for c in commits] == expected
