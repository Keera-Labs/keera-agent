"""
Entry point for `python -m keera_mcp`.

We strip '' and '.' from sys.path before importing the mcp SDK so that
packages/mcp/mcp.py (the Keera protocol stub) doesn't shadow the installed
`mcp` package.
"""
import sys

# Remove CWD entries before any mcp SDK imports to avoid the local mcp.py stub
# shadowing the official mcp package installed in the virtual environment.
sys.path = [p for p in sys.path if p not in ("", ".")]

from keera_mcp.server import mcp  # noqa: E402


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
