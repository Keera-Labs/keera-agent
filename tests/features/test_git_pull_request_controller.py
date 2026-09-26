"""Feature tests for GET/POST /api/projects/{project_id}/git/pull-request.

`gh` is replaced by a shell script so no test ever talks to GitHub.
"""

import json
from unittest import mock

from fastapi_startkit.masoniteorm.testing import DatabaseTransaction

from databases.factories.project_factory import ProjectFactory
from tests.features.git_test_repo import GitTestRepo
from tests.test_case import TestCase

PR_JSON = json.dumps(
    {
        "number": 42,
        "url": "https://github.com/acme/app/pull/42",
        "title": "Add panel",
        "state": "OPEN",
        "isDraft": False,
        "baseRefName": "dev",
        "headRefName": "task/panel",
    }
)


class TestGitPullRequestController(TestCase, DatabaseTransaction):
    async def asyncSetUp(self):
        await super().asyncSetUp()
        self.repo = GitTestRepo(self).init()
        self.repo.write("a.txt", "a\n")
        self.repo.commit_all()
        self.repo.add_bare_remote()
        self.project = await ProjectFactory.new().create(path=str(self.repo.root))

    @property
    def url(self) -> str:
        return f"/api/projects/{self.project.id}/git/pull-request"

    def use_gh(self, script: str):
        patcher = mock.patch("app.services.github_cli.GH_BINARY", str(self.repo.fake_gh(script)))
        patcher.start()
        self.addCleanup(patcher.stop)

    async def test_show_returns_open_pr_for_current_branch(self):
        self.use_gh(f"echo '{PR_JSON}'")

        response = await self.get(self.url)

        response.assert_ok()
        assert response.json() == {
            "available": True,
            "error": None,
            "pull_request": {
                "number": 42,
                "url": "https://github.com/acme/app/pull/42",
                "title": "Add panel",
                "state": "OPEN",
                "is_draft": False,
                "base": "dev",
                "head": "task/panel",
            },
        }
        assert self.repo.gh_args()[0].startswith("pr view --json number,url")

    async def test_show_without_pr_returns_null(self):
        self.use_gh("echo 'no pull requests found for branch \"main\"' >&2; exit 1")

        body = (await self.get(self.url)).json()

        assert body == {"available": True, "error": None, "pull_request": None}

    async def test_show_when_gh_missing(self):
        with mock.patch("app.services.github_cli.GH_BINARY", "gh-definitely-not-installed"):
            body = (await self.get(self.url)).json()

        assert body == {"available": False, "error": "gh is not installed", "pull_request": None}

    async def test_show_when_gh_unauthenticated(self):
        self.use_gh("echo 'To get started with GitHub CLI, please run:  gh auth login' >&2; exit 4")

        body = (await self.get(self.url)).json()

        assert body["available"] is False
        assert body["error"] == "gh is not authenticated"

    async def test_show_reports_other_gh_errors(self):
        self.use_gh("echo 'none of the git remotes point to a GitHub host' >&2; exit 1")

        body = (await self.get(self.url)).json()

        assert body["available"] is True
        assert "GitHub host" in body["error"]
        assert body["pull_request"] is None

    async def test_show_on_non_git_project(self):
        project = await ProjectFactory.new().create(path=str(self.repo.base))

        body = (await self.get(f"/api/projects/{project.id}/git/pull-request")).json()

        assert body == {"available": False, "error": "Not a git repository", "pull_request": None}

    async def test_store_fills_from_commits_and_targets_dev_when_it_exists(self):
        self.repo.git("push", "-q", "origin", "main:dev")
        self.repo.git("fetch", "-q", "origin")
        self.use_gh(
            f'case "$2" in create) echo https://github.com/acme/app/pull/42 ;; '
            f"view) echo '{PR_JSON}' ;; esac"
        )

        response = await self.post(self.url, json={})

        response.assert_status(201)
        assert response.json()["pull_request"]["number"] == 42
        assert self.repo.gh_args()[0] == "pr create --base=dev --fill"

    async def test_store_with_title_body_base_and_draft(self):
        self.use_gh(f"[ \"$2\" = view ] && echo '{PR_JSON}'; exit 0")

        response = await self.post(
            self.url, json={"title": "My PR", "body": "Why", "base": "main", "draft": True}
        )

        response.assert_status(201)
        assert self.repo.gh_args()[0] == "pr create --base=main --title=My PR --body=Why --draft"

    async def test_store_without_dev_lets_gh_pick_the_default_base(self):
        self.use_gh(f"[ \"$2\" = view ] && echo '{PR_JSON}'; exit 0")

        await self.post(self.url, json={"title": "T"})

        assert self.repo.gh_args()[0] == "pr create --title=T --body="

    async def test_store_when_gh_missing_is_503(self):
        with mock.patch("app.services.github_cli.GH_BINARY", "gh-definitely-not-installed"):
            response = await self.post(self.url, json={})

        response.assert_status(503)
        assert response.json()["detail"] == "gh is not installed"

    async def test_store_failure_is_409_with_gh_stderr(self):
        self.use_gh("echo 'a pull request for branch \"main\" already exists' >&2; exit 1")

        response = await self.post(self.url, json={"title": "Dup"})

        response.assert_status(409)
        assert "already exists" in response.json()["detail"]

    async def test_store_rejects_option_like_base(self):
        response = await self.post(self.url, json={"base": "--web"})
        response.assert_status(422)
