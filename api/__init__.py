from importlib.metadata import PackageNotFoundError, version

try:
    __version__ = version("codecity")
except PackageNotFoundError:
    # Editable-install fallback: package not yet registered.
    __version__ = "0.0.0+unknown"
