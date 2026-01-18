import pytest
from httpx import ASGITransport, AsyncClient

from codecity.api.app import create_app


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_city_endpoint_requires_repo_path() -> None:
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get("/api/city")
        assert response.status_code == 422  # Missing required param
