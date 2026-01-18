# src/codecity/api/tests/test_websocket.py
from starlette.testclient import TestClient

from codecity.api.app import create_app


def test_websocket_endpoint_exists() -> None:
    app = create_app()
    client = TestClient(app)

    # WebSocket connection should be accepted
    with client.websocket_connect("/ws") as _websocket:
        # Just verify we can connect
        pass
