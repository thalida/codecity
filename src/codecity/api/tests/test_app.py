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


@pytest.fixture
def temp_git_repo_with_folder() -> Iterator[Path]:
    """Create a temporary git repository with files in a subfolder."""
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

        # Create a subfolder with a file (so streets are generated)
        src_folder = repo_path / "src"
        src_folder.mkdir()
        sample_file = src_folder / "main.py"
        sample_file.write_text("print('hello world')\n")

        # Commit the file
        subprocess.run(
            ["git", "add", "src/main.py"],
            cwd=repo_path,
            check=True,
            capture_output=True,
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
async def test_maplibre_index_returns_200(client: AsyncClient) -> None:
    """Test that GET /maplibre returns status 200 and serves the MapLibre HTML."""
    response = await client.get("/maplibre")
    assert response.status_code == 200
    # Verify it's serving HTML content
    assert "text/html" in response.headers.get("content-type", "")


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


@pytest.mark.asyncio
async def test_city_endpoint_includes_street_color(
    client: AsyncClient, temp_git_repo: Path
) -> None:
    response = await client.get("/api/city", params={"repo_path": str(temp_git_repo)})
    assert response.status_code == 200
    data = response.json()
    # Root won't have color, but check structure exists
    assert "root" in data
    root = data["root"]
    assert "color" in root
    assert "road_width" in root


def test_api_returns_grid_layout_data() -> None:
    """Test that _city_to_dict includes grid layout data when present."""
    from datetime import datetime, timezone

    from codecity.analysis import FileMetrics, generate_city_layout
    from codecity.api.app import _city_to_dict

    # Create sample file metrics
    now = datetime.now(timezone.utc)
    file_metrics = [
        FileMetrics(
            path="src/main.py",
            lines_of_code=100,
            avg_line_length=40.0,
            language="Python",
            created_at=now,
            last_modified=now,
        ),
        FileMetrics(
            path="src/utils.py",
            lines_of_code=50,
            avg_line_length=35.0,
            language="Python",
            created_at=now,
            last_modified=now,
        ),
    ]

    # Generate city (grid layout is now the default)
    city = generate_city_layout(file_metrics, "/test/repo")

    # Serialize to dict
    result = _city_to_dict(city)

    # Verify layout_type is "grid"
    assert result["layout_type"] == "grid"

    # Verify bounds are present
    assert "bounds" in result
    bounds = result["bounds"]
    assert "min_x" in bounds
    assert "min_z" in bounds
    assert "max_x" in bounds
    assert "max_z" in bounds

    # Verify grid dict is present with string keys "x,z"
    assert "grid" in result
    grid = result["grid"]
    assert isinstance(grid, dict)
    # Check at least one grid key is in "x,z" format
    if grid:
        first_key = next(iter(grid.keys()))
        assert "," in first_key
        parts = first_key.split(",")
        assert len(parts) == 2
        # Verify values have expected structure
        first_tile = grid[first_key]
        assert "type" in first_tile
        assert "path" in first_tile
        assert "parent" in first_tile

    # Verify buildings dict is present
    assert "buildings" in result
    buildings = result["buildings"]
    assert isinstance(buildings, dict)
    # Check building structure
    if buildings:
        first_building = next(iter(buildings.values()))
        assert "file_path" in first_building
        assert "x" in first_building
        assert "z" in first_building
        assert "road_side" in first_building
        assert "road_direction" in first_building
        assert "height" in first_building
        assert "width" in first_building
        assert "depth" in first_building
        assert "language" in first_building
        assert "created_at" in first_building
        assert "last_modified" in first_building

    # Verify streets dict is present
    assert "streets" in result
    streets = result["streets"]
    assert isinstance(streets, dict)
    # Check street structure
    if streets:
        first_street = next(iter(streets.values()))
        assert "name" in first_street
        assert "start" in first_street
        assert "end" in first_street
        assert "direction" in first_street
        assert "color" in first_street
        assert "depth" in first_street


@pytest.mark.asyncio
async def test_get_city_geojson_returns_feature_collection(
    client: AsyncClient, temp_git_repo: Path
) -> None:
    response = await client.get(
        "/api/city.geojson", params={"repo_path": str(temp_git_repo)}
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/geo+json"

    data = response.json()
    assert data["type"] == "FeatureCollection"
    assert "features" in data


@pytest.mark.asyncio
async def test_get_city_geojson_has_streets_and_buildings(
    client: AsyncClient, temp_git_repo_with_folder: Path
) -> None:
    response = await client.get(
        "/api/city.geojson", params={"repo_path": str(temp_git_repo_with_folder)}
    )
    data = response.json()

    layers = {f["properties"]["layer"] for f in data["features"]}
    assert "streets" in layers
    assert "buildings" in layers
