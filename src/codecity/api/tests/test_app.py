import subprocess
import tempfile
from collections.abc import AsyncIterator, Iterator
from pathlib import Path

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from codecity.api.app import create_app


@pytest.fixture
def temp_git_repo() -> Iterator[Path]:
    """Create a temporary git repository with a sample file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        repo_path = Path(tmpdir)

        # Initialize git repo
        subprocess.run(["git", "init"], cwd=repo_path, check=True, capture_output=True)
        subprocess.run(
            ["git", "config", "user.email", "test@test.com"],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )
        subprocess.run(
            ["git", "config", "user.name", "Test User"],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )

        # Create a sample file
        sample_file = repo_path / "sample.py"
        sample_file.write_text("print('hello world')\n")

        # Commit the file
        subprocess.run(
            ["git", "add", "sample.py"], cwd=repo_path, check=True, capture_output=True
        )
        subprocess.run(
            ["git", "commit", "-m", "Initial commit"],
            cwd=repo_path,
            check=True,
            capture_output=True,
        )

        yield repo_path


@pytest_asyncio.fixture
async def client() -> AsyncIterator[AsyncClient]:
    """Create a test client for the API."""
    app = create_app()
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as async_client:
        yield async_client


@pytest.mark.asyncio
async def test_health_endpoint(client: AsyncClient) -> None:
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_city_endpoint_requires_repo_path_when_no_default(
    client: AsyncClient,
) -> None:
    # Without app.state.repo_path set, should return 400
    response = await client.get("/api/city")
    assert response.status_code == 400
    assert response.json() == {"error": "repo_path is required"}


@pytest.mark.asyncio
async def test_city_endpoint_returns_city_data(
    client: AsyncClient, temp_git_repo: Path
) -> None:
    response = await client.get("/api/city", params={"repo_path": str(temp_git_repo)})
    assert response.status_code == 200

    data = response.json()
    assert "repo_path" in data
    assert "root" in data
    assert "generated_at" in data


@pytest.mark.asyncio
async def test_city_endpoint_returns_404_for_nonexistent_repo(
    client: AsyncClient,
) -> None:
    response = await client.get(
        "/api/city", params={"repo_path": "/nonexistent/path/to/repo"}
    )
    assert response.status_code == 404
    assert "error" in response.json()


@pytest.mark.asyncio
async def test_index_returns_200(client: AsyncClient) -> None:
    """Test that GET / returns status 200."""
    response = await client.get("/")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_styles_css_returns_200(client: AsyncClient) -> None:
    """Test that GET /styles.css returns status 200."""
    response = await client.get("/styles.css")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_nonexistent_file_returns_404(client: AsyncClient) -> None:
    """Test that GET /nonexistent.file returns 404."""
    response = await client.get("/nonexistent.file")
    assert response.status_code == 404
