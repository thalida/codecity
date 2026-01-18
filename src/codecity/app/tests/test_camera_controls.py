# src/codecity/app/tests/test_camera_controls.py
"""Tests for camera control implementation in main.js.

Since the camera controls are implemented in JavaScript for the browser,
these tests verify the implementation by checking the source code contains
the expected patterns for Google Maps-like controls.
"""

from codecity.app import APP_DIR


def _read_main_js() -> str:
    """Read the main.js file content."""
    return (APP_DIR / "main.js").read_text()


class TestCameraSetup:
    """Tests for camera initialization."""

    def test_camera_is_arc_rotate_camera(self) -> None:
        """Verify camera is ArcRotateCamera for orbital controls."""
        content = _read_main_js()
        assert "new BABYLON.ArcRotateCamera" in content

    def test_camera_has_zoom_limits(self) -> None:
        """Verify camera has zoom limits to prevent extreme zoom."""
        content = _read_main_js()
        assert "lowerRadiusLimit" in content
        assert "upperRadiusLimit" in content

    def test_camera_has_angle_limits(self) -> None:
        """Verify camera has vertical angle limits."""
        content = _read_main_js()
        assert "lowerBetaLimit" in content
        assert "upperBetaLimit" in content

    def test_camera_does_not_use_default_controls(self) -> None:
        """Verify default Babylon.js controls are not attached.

        The default attachControl() would conflict with custom controls.
        """
        content = _read_main_js()
        # Should NOT have attachControl call (it's commented out or removed)
        # Check that attachControl is only in comments, not active code
        lines = content.split("\n")
        for line in lines:
            stripped = line.strip()
            if "attachControl" in stripped and not stripped.startswith("//"):
                # If attachControl is found not in a comment, it should be
                # in a comment explaining why we don't use it
                assert (
                    "DO NOT" in line or "would add" in line.lower()
                ), f"Found active attachControl call: {line}"


class TestPointerEvents:
    """Tests for pointer event handling (mouse and touch)."""

    def test_uses_pointer_events_not_mouse_events(self) -> None:
        """Verify pointer events are used for cross-browser support."""
        content = _read_main_js()
        assert "pointerdown" in content
        assert "pointermove" in content
        assert "pointerup" in content

    def test_uses_pointer_capture(self) -> None:
        """Verify pointer capture is used for drag operations outside canvas."""
        content = _read_main_js()
        assert "setPointerCapture" in content
        assert "releasePointerCapture" in content

    def test_handles_pointer_cancel(self) -> None:
        """Verify pointercancel is handled for interrupted gestures."""
        content = _read_main_js()
        assert "pointercancel" in content


class TestPanControls:
    """Tests for left-click pan (Google Maps-like)."""

    def test_left_click_triggers_pan(self) -> None:
        """Verify left click (button === 0) starts panning."""
        content = _read_main_js()
        # Should check for button 0 (left click) for pan
        assert "e.button === 0" in content or "e.button == 0" in content

    def test_pan_modifies_camera_target(self) -> None:
        """Verify panning moves camera target, not camera position."""
        content = _read_main_js()
        assert "camera.target.x" in content
        assert "camera.target.z" in content

    def test_pan_accounts_for_camera_orientation(self) -> None:
        """Verify pan direction considers camera's horizontal angle."""
        content = _read_main_js()
        # Should use camera.alpha for orientation-aware panning
        assert "camera.alpha" in content
        assert "Math.cos" in content
        assert "Math.sin" in content


class TestRotateControls:
    """Tests for right-click rotate."""

    def test_right_click_triggers_rotate(self) -> None:
        """Verify right click (button === 2) starts rotation."""
        content = _read_main_js()
        # Should check for button 2 (right click) for rotate
        assert "e.button === 2" in content or "e.button == 2" in content

    def test_rotate_modifies_camera_angles(self) -> None:
        """Verify rotation changes camera alpha and beta angles."""
        content = _read_main_js()
        # Should modify alpha (horizontal) and beta (vertical) angles
        assert "camera.alpha -=" in content or "camera.alpha +=" in content
        assert "camera.beta -=" in content or "camera.beta +=" in content

    def test_rotate_clamps_beta_to_limits(self) -> None:
        """Verify beta angle is clamped to prevent flipping."""
        content = _read_main_js()
        # Should clamp beta between limits
        assert "Math.max" in content
        assert "Math.min" in content


class TestZoomControls:
    """Tests for scroll wheel zoom."""

    def test_wheel_event_zooms(self) -> None:
        """Verify scroll wheel changes zoom."""
        content = _read_main_js()
        assert "wheel" in content
        assert "deltaY" in content

    def test_zoom_modifies_camera_radius(self) -> None:
        """Verify zoom changes camera radius (distance from target)."""
        content = _read_main_js()
        # Can be += or = assignment
        assert "camera.radius" in content and (
            "radius *" in content or "radius +" in content
        )

    def test_zoom_respects_limits(self) -> None:
        """Verify zoom is clamped to radius limits."""
        content = _read_main_js()
        # Should reference the limits when clamping
        assert "lowerRadiusLimit" in content
        assert "upperRadiusLimit" in content

    def test_wheel_prevents_default(self) -> None:
        """Verify wheel event prevents page scroll."""
        content = _read_main_js()
        assert "preventDefault" in content


class TestContextMenu:
    """Tests for context menu handling."""

    def test_context_menu_prevented(self) -> None:
        """Verify right-click context menu is suppressed."""
        content = _read_main_js()
        assert "contextmenu" in content
        assert "preventDefault" in content


class TestCursorFeedback:
    """Tests for visual cursor feedback."""

    def test_default_cursor_is_grab(self) -> None:
        """Verify default cursor indicates draggable surface."""
        content = _read_main_js()
        assert "'grab'" in content or '"grab"' in content

    def test_dragging_cursor_is_grabbing(self) -> None:
        """Verify cursor changes during drag."""
        content = _read_main_js()
        assert "'grabbing'" in content or '"grabbing"' in content
