"""The framing/sniffing headers, and who /api answers to.

Both live in the app rather than only on the deploy's proxy, so a container run
anywhere carries them."""

from __future__ import annotations

from pathlib import Path

import httpx2
import pytest
from fastapi.testclient import TestClient

from api.app import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html>")
    return TestClient(create_app(static_dir=static))


def _directives(response: httpx2.Response) -> dict[str, str]:
    """The CSP parsed into {name: value}, so a test names one directive rather
    than pinning the whole header string."""
    out: dict[str, str] = {}
    for part in response.headers["content-security-policy"].split(";"):
        name, _, value = part.strip().partition(" ")
        out[name] = value
    return out


def test_the_page_cannot_be_framed(client: TestClient) -> None:
    r = client.get("/")
    assert _directives(r)["frame-ancestors"] == "'none'"
    assert r.headers["x-frame-options"] == "DENY"


def test_everything_defaults_to_this_origin(client: TestClient) -> None:
    """Scripts, styles, workers, fonts and both SSE streams are all served from
    here, so nothing below needs its own directive to relax."""
    assert _directives(client.get("/"))["default-src"] == "'self'"


def test_nothing_inline_or_evaluated_is_allowed(client: TestClient) -> None:
    """The whole point of the policy: an injected <script> or style has no
    source expression that would let it run."""
    csp = client.get("/").headers["content-security-policy"]
    assert "unsafe-inline" not in csp
    assert "unsafe-eval" not in csp


def test_the_readme_can_load_its_own_assets(client: TestClient) -> None:
    """A README points its images at whatever host it likes; data: is the
    bundled icon set and blob: the textures the facades build."""
    img = _directives(client.get("/"))["img-src"]
    assert img.split() == ["'self'", "data:", "blob:", "https:"]


def test_the_pdf_preview_can_still_embed(client: TestClient) -> None:
    """object-src 'none' is the usual advice and would blank the PDF preview,
    which renders through <embed type="application/pdf">."""
    assert _directives(client.get("/"))["object-src"] == "'self'"


def test_a_repos_bytes_can_be_framed_by_the_app_itself(client: TestClient) -> None:
    """Chrome's PDF viewer will not paint an <embed> whose response says
    frame-ancestors 'none', even same-origin, so the preview needs 'self'."""
    r = client.get("/api/file", params={"src": "/nope", "path": "x.pdf"})
    assert _directives(r)["frame-ancestors"] == "'self'"
    assert r.headers["x-frame-options"] == "SAMEORIGIN"


def test_relaxing_that_costs_nothing_cross_site(client: TestClient) -> None:
    """The framing 'self' gives back is only reachable from here: a browser
    labels anyone else's frame cross-site, and that never reaches the route."""
    r = client.get(
        "/api/file",
        params={"src": "/nope", "path": "x.pdf"},
        headers={"sec-fetch-site": "cross-site"},
    )
    assert r.status_code == 403


def test_the_api_reference_keeps_only_the_framing_half(client: TestClient) -> None:
    """Scalar is a third-party bundle from a CDN: the app's policy would block
    it outright, so that page carries frame-ancestors alone."""
    r = client.get("/api/docs")
    assert r.headers["content-security-policy"] == "frame-ancestors 'none'"


def test_headers_ride_on_api_responses_too(client: TestClient) -> None:
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "camera=()" in r.headers["permissions-policy"]


def test_headers_survive_an_error_response(client: TestClient) -> None:
    """The exception handler builds its own JSONResponse; the headers are added
    outside it, or a 404 would be the one page that could be framed."""
    r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.headers["x-frame-options"] == "DENY"


def test_a_cross_site_api_request_is_refused(client: TestClient) -> None:
    """An <img src> on someone else's page: the browser labels it, and page
    JavaScript cannot unlabel it — sec-fetch-* is a forbidden header."""
    r = client.get("/api/health", headers={"sec-fetch-site": "cross-site"})
    assert r.status_code == 403
    assert r.json()["error"]


@pytest.mark.parametrize("site", ["same-origin", "same-site", "none"])
def test_the_app_and_the_address_bar_still_work(client: TestClient, site: str) -> None:
    assert (
        client.get("/api/health", headers={"sec-fetch-site": site}).status_code == 200
    )


def test_a_request_with_no_label_passes(client: TestClient) -> None:
    """curl, a script, the test client: not a browser, so not the thing this
    defends against, and blocking it would break every non-browser caller."""
    assert client.get("/api/health").status_code == 200


def test_the_page_itself_is_not_gated(client: TestClient) -> None:
    """Only /api is. A hotlinked favicon is not a repo's bytes."""
    r = client.get("/", headers={"sec-fetch-site": "cross-site"})
    assert r.status_code == 200
