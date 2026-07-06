"""Playwright browser automation MCP tools."""

import asyncio
import base64
from typing import Any, Optional

from fastapi_startkit.mcp import Response, Tool
from pydantic import BaseModel, Field

_browser: Any = None
_page: Any = None
_lock = asyncio.Lock()


async def _get_page():
    global _browser, _page
    async with _lock:
        if _browser is None:
            from playwright.async_api import async_playwright

            _pw = await async_playwright().start()
            _browser = await _pw.chromium.launch(headless=False)
            _page = await _browser.new_page()
        elif _page is None or _page.is_closed():
            _page = await _browser.new_page()
    return _page


# ── browser_navigate ──────────────────────────────────────────────────────────


class BrowserNavigateInput(BaseModel):
    url: str = Field(description="The full URL to navigate to (e.g. http://localhost:8000).")


class BrowserNavigateTool(Tool):
    name = "browser_navigate"
    description = "Navigate the browser to a URL. Always call this before any other browser tools."

    def schema(self):
        return BrowserNavigateInput

    async def handle(self, arguments: dict) -> Response:
        url = arguments["url"]
        page = await _get_page()
        response = await page.goto(url, wait_until="networkidle", timeout=15000)
        status = response.status if response else "unknown"
        title = await page.title()
        return Response.text(f"Navigated to {url} — HTTP {status}, title: '{title}'")


# ── browser_click ─────────────────────────────────────────────────────────────


class BrowserClickInput(BaseModel):
    selector: str = Field(description="CSS selector for the element to click.")


class BrowserClickTool(Tool):
    name = "browser_click"
    description = "Click an element on the current page by CSS selector."

    def schema(self):
        return BrowserClickInput

    async def handle(self, arguments: dict) -> Response:
        selector = arguments["selector"]
        page = await _get_page()
        await page.click(selector, timeout=5000)
        return Response.text(f"Clicked '{selector}'")


# ── browser_fill ──────────────────────────────────────────────────────────────


class BrowserFillInput(BaseModel):
    selector: str = Field(description="CSS selector for the input element.")
    value: str = Field(description="Text value to type into the field.")


class BrowserFillTool(Tool):
    name = "browser_fill"
    description = "Fill an input field on the current page."

    def schema(self):
        return BrowserFillInput

    async def handle(self, arguments: dict) -> Response:
        selector = arguments["selector"]
        value = arguments["value"]
        page = await _get_page()
        await page.fill(selector, value, timeout=5000)
        return Response.text(f"Filled '{selector}' with '{value}'")


# ── browser_assert_text ───────────────────────────────────────────────────────


class BrowserAssertTextInput(BaseModel):
    selector: str = Field(description="CSS selector for the element to check.")
    text: str = Field(description="Expected text (substring match).")


class BrowserAssertTextTool(Tool):
    name = "browser_assert_text"
    description = (
        "Assert that an element on the page contains the expected text. Returns PASS or FAIL."
    )

    def schema(self):
        return BrowserAssertTextInput

    async def handle(self, arguments: dict) -> Response:
        selector = arguments["selector"]
        expected = arguments["text"]
        page = await _get_page()
        try:
            element = await page.wait_for_selector(selector, timeout=5000)
            if element is None:
                return Response.text(f"FAIL: element '{selector}' not found")
            actual = (await element.inner_text()).strip()
            if expected in actual:
                return Response.text(f"PASS: '{selector}' contains '{expected}'")
            return Response.text(
                f"FAIL: '{selector}' has text '{actual}', expected to contain '{expected}'"
            )
        except Exception as exc:
            return Response.text(f"FAIL: {exc}")


# ── browser_screenshot ────────────────────────────────────────────────────────


class BrowserScreenshotInput(BaseModel):
    selector: Optional[str] = Field(
        default=None,
        description="Optional CSS selector — screenshot only that element. Omit for full page.",
    )


class BrowserScreenshotTool(Tool):
    name = "browser_screenshot"
    description = "Take a screenshot of the current page and return it as a base64-encoded PNG."

    def schema(self):
        return BrowserScreenshotInput

    async def handle(self, arguments: dict) -> Response:
        page = await _get_page()
        selector = arguments.get("selector")
        if selector:
            element = await page.wait_for_selector(selector, timeout=5000)
            if element is None:
                return Response.text(f"Error: element '{selector}' not found")
            png_bytes = await element.screenshot()
        else:
            png_bytes = await page.screenshot(full_page=True)
        b64 = base64.b64encode(png_bytes).decode()
        size_kb = len(png_bytes) // 1024
        return Response.text(
            f"Screenshot captured ({size_kb} KB). base64_png={b64[:80]}... (truncated)"
        )


# ── tool list ─────────────────────────────────────────────────────────────────

BROWSER_TOOLS = [
    BrowserNavigateTool,
    BrowserClickTool,
    BrowserFillTool,
    BrowserAssertTextTool,
    BrowserScreenshotTool,
]
