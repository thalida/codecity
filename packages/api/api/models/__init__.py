"""The shapes that cross a boundary.

    manifest   the domain data — what the scanner builds, the caches persist,
               the SSE stream serialises, and the OpenAPI schema (and from it
               app/src/types/manifest.generated.ts) is generated from
    events     the `data:` bodies of the SSE events
    responses  the JSON bodies of the plain routes

Import from the submodule, not from here: `manifest` is read by every layer
while `events` and `responses` are the HTTP layer's alone, and a barrel that
flattened the three would hide that difference. The event NAMES and error codes
are not here at all — they are wire vocabulary the scanner and git layers also
speak, so they live in api/core/constants.py.
"""
