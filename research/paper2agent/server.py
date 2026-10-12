"""Local stdio only; one tool, no resource loading, no broker or HTTP transport."""
from fastmcp import FastMCP
from adapter import minimum_variance
from typing import Any
from fastmcp.exceptions import ToolError
from pydantic import ValidationError

mcp = FastMCP("Gelt reviewed minimum-variance reference")
@mcp.tool
def min_variance(request: dict[str, Any]) -> dict:
    """Compute bounded reference minimum variance, never a trading recommendation."""
    try:
        return minimum_variance(request)
    except ValidationError as exc:
        raise ToolError("Invalid covariance request: strict numeric types, dimensions, unique tickers, symmetry and PSD are required.") from exc
    except ValueError as exc:
        raise ToolError(str(exc)) from exc

if __name__ == "__main__":
    mcp.run(transport="stdio", show_banner=False)
