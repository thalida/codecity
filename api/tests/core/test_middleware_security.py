"""The framing/sniffing headers, and who /api answers to.

Both live in the app rather than only on the deploy's proxy, so a container run
anywhere carries them."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.app import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    static = tmp_path / "static"
    static.mkdir()
    (static / "index.html").write_text("<!doctype html>")
    return TestClient(create_app(static_dir=static))


def test_the_page_cannot_be_framed(client: TestClient) -> None:
    r = client.get("/")
    assert r.headers["content-security-policy"] == "frame-ancestors 'none'"
    assert r.headers["x-frame-options"] == "DENY"


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
