# src/codecity/api/websocket.py
import asyncio
from pathlib import Path
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

from codecity.api.watcher import FileWatcher


class ConnectionManager:
    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass


manager = ConnectionManager()


async def websocket_endpoint(
    websocket: WebSocket, repo_path: str | None = None
) -> None:
    await manager.connect(websocket)

    try:
        if repo_path:
            watcher = FileWatcher(Path(repo_path))

            async def watch_and_broadcast():
                async for event in watcher.watch():
                    await manager.broadcast(
                        {
                            "type": "file_change",
                            "path": event.path,
                            "change_type": event.change_type,
                        }
                    )

            watch_task = asyncio.create_task(watch_and_broadcast())

            try:
                while True:
                    # Keep connection alive, handle incoming messages
                    _data = await websocket.receive_text()
                    # Could handle commands here
            except WebSocketDisconnect:
                watch_task.cancel()
                try:
                    await watch_task
                except asyncio.CancelledError:
                    pass
        else:
            # No repo path, just keep connection alive
            while True:
                await websocket.receive_text()

    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)
