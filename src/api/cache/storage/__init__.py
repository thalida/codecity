"""Where cached bytes land, and how they get there and back.

Nothing here knows what it is storing. `paths` decides names and locations,
`store` owns the two invariants everything above depends on: writes are atomic,
and a read returns None rather than raising.

No barrel: the caches import the module they need by name. `api.cache` is the
front door for everyone outside the package.
"""
