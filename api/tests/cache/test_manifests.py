"""Built manifests, ref reconstructions and timeline bundles, plus the
retention sweep the three of them share."""

from __future__ import annotations

import gzip
import json
import os
from pathlib import Path


from api import cache as cache_mod
from api.cache.results import history as cache_history
from api.cache.results import manifests as cache_manifests
from api.cache.storage import paths as cache_paths
from api.cache.storage.paths import ManifestFamily
from api.models.manifest import Manifest, TimelineBundle
from api.tests.conftest import make_manifest, make_timeline_bundle
from api.tests.cache._helpers import CacheTestBase


class ManifestCacheTests(CacheTestBase):
    def _make_manifest(self) -> Manifest:
        return make_manifest("/some/repo")

    def test_roundtrip(self) -> None:
        root = Path("/some/repo")
        sig = "deadbeef" * 4
        manifest = self._make_manifest()
        cache_mod.cache_save_manifest(root, sig, manifest)
        self.assertEqual(cache_mod.cache_load_manifest(root, sig), manifest)

    def test_load_wrong_signature_returns_none(self) -> None:
        cache_mod.cache_save_manifest(
            Path("/x"),
            "a" * 32,
            self._make_manifest(),
        )
        self.assertIsNone(cache_mod.cache_load_manifest(Path("/x"), "b" * 32))

    def test_manifest_rejects_when_git_history_version_changed(self):
        """A manifest cache file written under a prior _GIT_HISTORY_CACHE_VERSION
        must be dropped on load, because the composite version string changes
        when git-history bumps."""

        from api.cache import cache_load_manifest
        from api.cache.storage.paths import manifest_cache_path as _manifest_cache_path

        # Write a manifest stamped with a version string that mimics the
        # OLD git-history version (current minus one).
        old_g = cache_history.VERSION - 1
        stale_version = f"m{cache_manifests.MANIFEST_SCHEMA_VERSION}-g{old_g}"
        root = Path("/fake/root")
        sig = "deadbeef" * 8
        path = _manifest_cache_path(root, sig)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Manifest cache files are gzipped JSON.
        payload = json.dumps(
            {
                "version": stale_version,
                "manifest": {
                    "root": str(root),
                    "scanned_at": "x",
                    "content_signature": sig,
                    "structure_signature": sig,
                    "tree": {},
                    "repo": None,
                    "commits": None,
                },
            }
        )
        with gzip.open(path, "wb") as fh:
            fh.write(payload.encode("utf-8"))
        # Loader must reject.
        self.assertIsNone(cache_load_manifest(root, sig))
        # And collect it: a version bump makes every earlier entry permanently
        # unreadable, and a repo never scanned again is never revisited.
        self.assertFalse(path.exists())

    def test_a_corrupt_entry_is_collected_on_read(self) -> None:
        from api.cache import cache_load_manifest
        from api.cache.storage.paths import manifest_cache_path

        root, sig = Path("/fake/root"), "beefbeef" * 8
        path = manifest_cache_path(root, sig)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"not gzip, not json, not anything")

        self.assertIsNone(cache_load_manifest(root, sig))
        self.assertFalse(path.exists())

    def test_a_cold_miss_does_not_touch_the_directory(self) -> None:
        """Nothing to collect when the entry was never written, and a miss must
        not create or disturb anything on the way past."""
        from api.cache import cache_load_manifest

        self.assertIsNone(cache_load_manifest(Path("/never/scanned"), "f" * 32))

    def test_ref_manifest_roundtrip(self) -> None:
        root = Path("/some/repo")
        sha = "a" * 40
        manifest = self._make_manifest()
        cache_mod.cache_save_ref_manifest(root, sha, manifest)
        self.assertEqual(cache_mod.cache_load_ref_manifest(root, sha), manifest)

    def test_ref_manifest_load_missing_returns_none(self) -> None:
        self.assertIsNone(
            cache_mod.cache_load_ref_manifest(Path("/never/scanned"), "b" * 40)
        )

    def _make_bundle(self) -> TimelineBundle:
        return make_timeline_bundle(unionManifest=self._make_manifest())

    def test_timeline_roundtrip(self) -> None:
        root = Path("/some/repo")
        sha = "a" * 40
        bundle = self._make_bundle()
        cache_mod.cache_save_timeline(root, sha, bundle)
        self.assertEqual(cache_mod.cache_load_timeline(root, sha), bundle)

    def test_timeline_excludes_key_separately(self) -> None:
        # Excludes reshape the filtered union, so they are part of the key: one
        # exclude set's bundle must never be served for another.
        root = Path("/some/repo")
        sha = "a" * 40
        base, filtered = self._make_bundle(), self._make_bundle()
        filtered.note = "filtered"  # make the two bundles distinguishable
        cache_mod.cache_save_timeline(root, sha, base)
        cache_mod.cache_save_timeline(root, sha, filtered, frozenset({"secrets"}))

        self.assertEqual(cache_mod.cache_load_timeline(root, sha), base)
        self.assertEqual(
            cache_mod.cache_load_timeline(root, sha, frozenset({"secrets"})), filtered
        )
        # A different exclude set is a miss, not a wrong-bundle hit.
        self.assertIsNone(
            cache_mod.cache_load_timeline(root, sha, frozenset({"other"}))
        )

    def test_clear_timeline_evicts_all_heads_only(self) -> None:
        # A no_cache scan clears every timeline bundle for the root (all HEADs)
        # but leaves the manifest caches untouched.
        root = Path("/x")
        cache_mod.cache_save_manifest(root, "a" * 32, self._make_manifest())
        cache_mod.cache_save_timeline(root, "b" * 40, self._make_bundle())
        cache_mod.cache_save_timeline(root, "c" * 40, self._make_bundle())

        deleted = cache_mod.cache_clear_timeline(root)
        self.assertEqual(deleted, 2)
        self.assertIsNone(cache_mod.cache_load_timeline(root, "b" * 40))
        self.assertIsNone(cache_mod.cache_load_timeline(root, "c" * 40))
        self.assertIsNotNone(cache_mod.cache_load_manifest(root, "a" * 32))

    def test_clear_timeline_missing_dir_returns_zero(self) -> None:
        self.assertFalse((cache_paths.CACHE_ROOT / "manifests").exists())
        self.assertEqual(cache_mod.cache_clear_timeline(Path("/never")), 0)


class ManifestCachePruneTests(CacheTestBase):
    """Retention on the manifests/ dir.

    Every entry there is keyed by repo CONTENT, so the directory grew for the
    life of the install — 844 files / 281 MB on one dev machine before this.
    """

    def _manifest(self) -> Manifest:
        return make_manifest("/some/repo")

    def _names(self, root: Path) -> list[str]:
        prefix = f"{cache_paths.repo_key(root)}__"
        d = cache_paths.CACHE_ROOT / "manifests"
        return sorted(p.name[len(prefix) :] for p in d.glob(f"{prefix}*.json.gz"))

    def test_content_signatures_are_capped(self) -> None:
        root = Path("/x")
        keep = cache_manifests._KEEP[ManifestFamily.CONTENT]
        for i in range(keep + 4):
            cache_mod.cache_save_manifest(root, f"{i:032x}", self._manifest())

        self.assertEqual(len(self._names(root)), keep)

    def test_the_entry_just_written_always_survives(self) -> None:
        # Pruning runs after the save, so the newest write is never the victim.
        root = Path("/x")
        for i in range(cache_manifests._KEEP[ManifestFamily.CONTENT] + 3):
            sig = f"{i:032x}"
            cache_mod.cache_save_manifest(root, sig, self._manifest())
            self.assertIsNotNone(cache_mod.cache_load_manifest(root, sig))

    def test_families_are_capped_independently(self) -> None:
        # A scrub session writing many ref manifests must not evict the live
        # content-signature manifest out from under the running scan.
        root = Path("/x")
        cache_mod.cache_save_manifest(root, "a" * 32, self._manifest())
        for i in range(cache_manifests._KEEP[ManifestFamily.REF] + 5):
            cache_mod.cache_save_ref_manifest(root, f"{i:040x}", self._manifest())

        self.assertIsNotNone(cache_mod.cache_load_manifest(root, "a" * 32))
        refs = [n for n in self._names(root) if n.startswith("ref-")]
        self.assertEqual(len(refs), cache_manifests._KEEP[ManifestFamily.REF])

    def test_pruning_one_repo_leaves_another_alone(self) -> None:
        other = Path("/y")
        cache_mod.cache_save_manifest(other, "c" * 32, self._manifest())
        for i in range(cache_manifests._KEEP[ManifestFamily.CONTENT] + 3):
            cache_mod.cache_save_manifest(Path("/x"), f"{i:032x}", self._manifest())

        self.assertIsNotNone(cache_mod.cache_load_manifest(other, "c" * 32))

    def test_prune_on_a_never_scanned_root_is_a_noop(self) -> None:
        self.assertEqual(cache_mod.prune_manifest_cache(Path("/never/scanned")), 0)

    def test_prune_with_no_manifests_dir_is_a_noop(self) -> None:
        self.assertFalse((cache_paths.CACHE_ROOT / "manifests").exists())
        self.assertEqual(cache_mod.prune_manifest_cache(Path("/x")), 0)

    def test_protect_survives_even_when_it_ranks_oldest(self) -> None:
        # mtime can tie (one-second resolution), ranking the just-written entry
        # anywhere. Pinned to the worst case, it must still survive.
        root = Path("/x")
        d = cache_paths.CACHE_ROOT / "manifests"
        d.mkdir(parents=True, exist_ok=True)

        # Write past the cap directly, so setup does not prune as it goes.
        paths = []
        for i in range(cache_manifests._KEEP[ManifestFamily.CONTENT] + 3):
            path = cache_paths.manifest_cache_path(root, f"{i:032x}")
            cache_manifests._save_manifest(path, self._manifest())
            paths.append(path)

        victim = paths[0]
        os.utime(victim, (1, 1))  # oldest by a wide margin -> first to go

        cache_mod.prune_manifest_cache(root, protect=victim)

        self.assertTrue(victim.exists(), "protected entry was evicted")
        remaining = list(d.glob(f"{cache_paths.repo_key(root)}__*.json.gz"))
        self.assertEqual(len(remaining), cache_manifests._KEEP[ManifestFamily.CONTENT])
