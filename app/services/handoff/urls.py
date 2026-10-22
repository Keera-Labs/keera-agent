import re
from urllib.parse import urlsplit


def origin(url: str) -> str:
    parts = urlsplit(url.strip())
    return f"{parts.scheme}://{parts.netloc}"


def rewrite_keera_urls(text: str, source_base_url: str, target_base_url: str) -> str:
    source = urlsplit(source_base_url.strip())
    target = origin(target_base_url)
    port = source.port or (443 if source.scheme == "https" else 80)
    aliases = re.compile(rf"https?://[^\s/'\"`<>]+:{port}(?=/(?:mcp|api)\b)")
    exact = re.compile(re.escape(origin(source_base_url)) + r"(?![A-Za-z0-9.:-])")
    return aliases.sub(lambda _: target, exact.sub(lambda _: target, text))
