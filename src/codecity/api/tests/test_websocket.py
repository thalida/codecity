# src/codecity/api/tests/test_websocket.py
from unittest.mock import MagicMock

import pytest
from starlette.testclient import TestClient

from codecity.api.app import create_app


def test_websocket_endpoint_exists() -> None:
    app = create_app()
    client = TestClient(app)

    # WebSocket connection should be accepted
    with client.websocket_connect("/ws") as _websocket:
        # Just verify we can connect
        pass


def test_connection_manager_tracks_connections() -> None:
    from codecity.api.websocket import ConnectionManager

    manager = ConnectionManager()
    # Test that connections list starts empty
    assert len(manager.active_connections) == 0


def test_connection_manager_disconnect_removes_connection() -> None:
    from codecity.api.websocket import ConnectionManager

    manager = ConnectionManager()
    mock_ws = MagicMock()
    manager.active_connections.append(mock_ws)

    manager.disconnect(mock_ws)
    assert mock_ws not in manager.active_connections


def test_connection_manager_multiple_connections() -> None:
    from codecity.api.websocket import ConnectionManager

    manager = ConnectionManager()
    mock_ws1 = MagicMock()
    mock_ws2 = MagicMock()
    mock_ws3 = MagicMock()

    # Add multiple connections
    manager.active_connections.append(mock_ws1)
    manager.active_connections.append(mock_ws2)
    manager.active_connections.append(mock_ws3)

    assert len(manager.active_connections) == 3
    assert mock_ws1 in manager.active_connections
    assert mock_ws2 in manager.active_connections
    assert mock_ws3 in manager.active_connections

    # Disconnect one
    manager.disconnect(mock_ws2)
    assert len(manager.active_connections) == 2
    assert mock_ws2 not in manager.active_connections
    assert mock_ws1 in manager.active_connections
    assert mock_ws3 in manager.active_connections


@pytest.mark.asyncio
async def test_connection_manager_broadcast() -> None:
    from codecity.api.websocket import ConnectionManager

    manager = ConnectionManager()
    mock_ws1 = MagicMock()
    mock_ws2 = MagicMock()

    # Make send_json a coroutine
    async def mock_send_json(_msg):
        pass

    mock_ws1.send_json = MagicMock(side_effect=mock_send_json)
    mock_ws2.send_json = MagicMock(side_effect=mock_send_json)

    manager.active_connections.append(mock_ws1)
    manager.active_connections.append(mock_ws2)

    message = {"type": "test", "data": "hello"}
    await manager.broadcast(message)

    mock_ws1.send_json.assert_called_once_with(message)
    mock_ws2.send_json.assert_called_once_with(message)
