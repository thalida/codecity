"""Field parity between the scanner's TypedDicts and the wire's Pydantic models.

`api/manifest_types.py` and `api/models/manifest.py` describe the same JSON
twice. The Pydantic side generates the OpenAPI schema, and from it
`app/src/types/manifest.generated.ts`. The TypedDict side is what the scanner
actually builds, and `routers/manifest.py` ships it down the SSE stream with a
plain `json.dumps` — Pydantic never sees it.

So a field one side has and the other doesn't means the frontend's generated
types are lying about what the server sends, and nothing else in the build
would notice: pyright checks the scanner against the TypedDicts, and FastAPI
checks the JSON routes against the models, but nothing connects the two.

Pairs are discovered by name, so a new shape added to both files is covered
without touching this test, and one added to only a single file fails it.
"""

from __future__ import annotations

import unittest

from pydantic import BaseModel

from api import manifest_types
from api.models import manifest as wire


def _typed_dict_names() -> list[str]:
    """Every TypedDict in manifest_types that has a same-named wire model."""
    out: list[str] = []
    for name in dir(manifest_types):
        scanner_side = getattr(manifest_types, name)
        if not isinstance(scanner_side, type):
            continue
        # TypedDict classes carry these; plain classes and aliases do not.
        if not hasattr(scanner_side, "__required_keys__"):
            continue
        wire_side = getattr(wire, name, None)
        if isinstance(wire_side, type) and issubclass(wire_side, BaseModel):
            out.append(name)
    return sorted(out)


class ManifestParityTests(unittest.TestCase):
    def test_pairs_are_discovered(self) -> None:
        """Guards the discovery itself: if the introspection silently stops
        matching anything, every other test here would vacuously pass."""
        names = _typed_dict_names()
        self.assertIn("Manifest", names)
        self.assertIn("RepoStats", names)
        self.assertGreater(len(names), 10, names)

    def test_fields_match(self) -> None:
        mismatches: list[str] = []
        for name in _typed_dict_names():
            scanner_side = getattr(manifest_types, name)
            wire_side = getattr(wire, name)
            scanner_fields = set(scanner_side.__annotations__)
            wire_fields = set(wire_side.model_fields)
            only_scanner = sorted(scanner_fields - wire_fields)
            only_wire = sorted(wire_fields - scanner_fields)
            if only_scanner:
                mismatches.append(
                    f"{name}: in manifest_types but NOT on the wire model: "
                    f"{', '.join(only_scanner)}"
                )
            if only_wire:
                mismatches.append(
                    f"{name}: on the wire model but NOT in manifest_types: "
                    f"{', '.join(only_wire)}"
                )
        self.assertEqual(mismatches, [], "\n" + "\n".join(mismatches))


if __name__ == "__main__":
    unittest.main()
