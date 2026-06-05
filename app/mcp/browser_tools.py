"""
Playwright browser automation MCP tools.

Maintains a single headless Chromium browser and page per server lifetime.
Tools share state: navigate() first, then click/fill/assert_text/screenshot.
"""

import base64
import asyncio
from typing import Any

_browser: Any = None
_page: Any = None
_lock = asyncio.Lock()


async def _get_page():
    global _browser, _page
    async with _lock:
        if _browser is None:
            from playwright.async_api import async_playwright
            _pw = await async_playwright().start()
            _browser = await _pw.chromium.launch(headless=True)
            _page = await _browser.new_page()
        elif _page is None or _page.is_closed():
            _page = await _browser.new_page()
    return _page


# ── tool: browser_navigate ────────────────────────────────────────────────────

NAVIGATE_SCHEMA = {
    "name": "browser_navigate",
    "description": "Navigate the browser to a URL. Always call this before any other browser tools.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "url": {
                "type": "string",
                "description": "The full URL to navigate to (e.g. http://localhost:8000).",
            },
        },
        "required": ["url"],
    },
}


async def handle_navigate(args: dict) -> str:
    url = args["url"]
    page = await _get_page()
    response = await page.goto(url, wait_until="networkidle", timeout=15000)
    status = response.status if response else "unknown"
    title = await page.title()
    return f"Navigated to {url} — HTTP {status}, title: '{title}'"


# ── tool: browser_click ───────────────────────────────────────────────────────

CLICK_SCHEMA = {
    "name": "browser_click",
    "description": "Click an element on the current page by CSS selector.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector for the element to click.",
            },
        },
        "required": ["selector"],
    },
}


async def handle_click(args: dict) -> str:
    selector = args["selector"]
    page = await _get_page()
    await page.click(selector, timeout=5000)
    return f"Clicked '{selector}'"


# ── tool: browser_fill ────────────────────────────────────────────────────────

FILL_SCHEMA = {
    "name": "browser_fill",
    "description": "Fill an input field on the current page.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector for the input element.",
            },
            "value": {
                "type": "string",
                "description": "Text value to type into the field.",
            },
        },
        "required": ["selector", "value"],
    },
}


async def handle_fill(args: dict) -> str:
    selector = args["selector"]
    value = args["value"]
    page = await _get_page()
    await page.fill(selector, value, timeout=5000)
    return f"Filled '{selector}' with '{value}'"


# ── tool: browser_assert_text ─────────────────────────────────────────────────

ASSERT_TEXT_SCHEMA = {
    "name": "browser_assert_text",
    "description": "Assert that an element on the page contains the expected text. Returns PASS or FAIL.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "CSS selector for the element to check.",
            },
            "text": {
                "type": "string",
                "description": "Expected text (substring match).",
            },
        },
        "required": ["selector", "text"],
    },
}


async def handle_assert_text(args: dict) -> str:
    selector = args["selector"]
    expected = args["text"]
    page = await _get_page()
    try:
        element = await page.wait_for_selector(selector, timeout=5000)
        if element is None:
            return f"FAIL: element '{selector}' not found"
        actual = (await element.inner_text()).strip()
        if expected in actual:
            return f"PASS: '{selector}' contains '{expected}'"
        return f"FAIL: '{selector}' has text '{actual}', expected to contain '{expected}'"
    except Exception as exc:
        return f"FAIL: {exc}"


# ── tool: browser_screenshot ──────────────────────────────────────────────────

SCREENSHOT_SCHEMA = {
    "name": "browser_screenshot",
    "description": "Take a screenshot of the current page and return it as a base64-encoded PNG.",
    "inputSchema": {
        "type": "object",
        "properties": {
            "selector": {
                "type": "string",
                "description": "Optional CSS selector — screenshot only that element. Omit for full page.",
            },
        },
        "required": [],
    },
}


async def handle_screenshot(args: dict) -> str:
    page = await _get_page()
    selector = args.get("selector")
    if selector:
        element = await page.wait_for_selector(selector, timeout=5000)
        if element is None:
            return f"Error: element '{selector}' not found"
        png_bytes = await element.screenshot()
    else:
        png_bytes = await page.screenshot(full_page=True)
    b64 = base64.b64encode(png_bytes).decode()
    size_kb = len(png_bytes) // 1024
    return f"Screenshot captured ({size_kb} KB). base64_png={b64[:80]}... (truncated)"


# ── registry entries ──────────────────────────────────────────────────────────

BROWSER_TOOLS = [
    NAVIGATE_SCHEMA,
    CLICK_SCHEMA,
    FILL_SCHEMA,
    ASSERT_TEXT_SCHEMA,
    SCREENSHOT_SCHEMA,
]

BROWSER_HANDLERS = {
    "browser_navigate": handle_navigate,
    "browser_click": handle_click,
    "browser_fill": handle_fill,
    "browser_assert_text": handle_assert_text,
    "browser_screenshot": handle_screenshot,
}
