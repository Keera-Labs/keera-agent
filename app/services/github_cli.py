"""Pull-request lookup and creation through the `gh` CLI for a git repository."""

import json

from app.services.git_repository import WRITE_TIMEOUT, GitRepository
from app.services.process import CommandError, CommandNotFound, run_command

GH_BINARY = "gh"
PR_FIELDS = "number,url,title,state,isDraft,baseRefName,headRefName"


class GhUnavailable(CommandError):
    """gh is missing or not logged in — the panel shows this instead of PR actions."""


def _unavailable_reason(stderr: str) -> str | None:
    lowered = stderr.lower()
    if "gh auth login" in lowered or "not logged in" in lowered:
        return "gh is not authenticated"
    return None


def _pull_request(data: dict) -> dict:
    return {
        "number": data["number"],
        "url": data["url"],
        "title": data["title"],
        "state": data["state"],
        "is_draft": data.get("isDraft", False),
        "base": data.get("baseRefName"),
        "head": data.get("headRefName"),
    }


class GitHubCli:
    def __init__(self, repo: GitRepository):
        self.repo = repo

    async def gh(self, *args: str, timeout: float = 30):
        try:
            result = await run_command([GH_BINARY, *args], cwd=self.repo.root, timeout=timeout)
        except CommandNotFound as e:
            raise GhUnavailable("gh is not installed") from e
        if not result.ok:
            reason = _unavailable_reason(result.stderr)
            if reason:
                raise GhUnavailable(reason, result.stderr)
        return result

    async def current_pull_request(self) -> dict | None:
        result = await self.gh("pr", "view", "--json", PR_FIELDS)
        if result.ok:
            return _pull_request(json.loads(result.text))
        if "no pull requests found" in result.stderr.lower():
            return None
        raise CommandError(result.output or "gh pr view failed", result.stderr)

    async def create_pull_request(
        self, title: str | None, body: str | None, base: str | None, draft: bool
    ) -> dict:
        args = ["pr", "create"]
        base = base or await self._default_base()
        # `--flag=value` so a user-supplied value starting with "-" can't become a flag.
        if base:
            args.append(f"--base={base}")
        if title:
            args += [f"--title={title}", f"--body={body or ''}"]
        else:
            args.append("--fill")
        if draft:
            args.append("--draft")

        result = await self.gh(*args, timeout=WRITE_TIMEOUT)
        if not result.ok:
            raise CommandError(result.output or "gh pr create failed", result.stderr)
        pull_request = await self.current_pull_request()
        if pull_request is None:
            raise CommandError(f"Pull request created but could not be read back: {result.text}")
        return pull_request

    async def _default_base(self) -> str | None:
        # Project convention: PRs target `dev` when it exists; otherwise gh uses the
        # repository's default branch.
        remote = await self.repo.default_remote()
        return "dev" if await self.repo.has_ref(f"refs/remotes/{remote}/dev") else None
