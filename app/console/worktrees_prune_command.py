import asyncio
import os

from cleo.helpers import option
from fastapi_startkit.console.command import Command

from app.services import worktree_cleanup as wc


def _size(kb: int) -> str:
    return f"{kb / 1024 / 1024:.2f}G" if kb >= 1024 * 1024 else f"{kb / 1024:.0f}M"


class WorktreesPruneCommand(Command):
    """
    Remove orphaned agent worktrees that hold no unsaved work.

    worktrees:prune
    """

    name = "worktrees:prune"
    description = "Remove clean, fully pushed worktrees no live agent owns; list the rest."
    options = [
        option("dry-run", None, "Only report what would be removed; change nothing."),
        option("project", "p", "Only scan the project with this id.", flag=False),
        option(
            "include-external",
            None,
            "Also consider worktrees outside .claude/worktrees and .worktrees.",
        ),
        option(
            "min-age-hours",
            None,
            "Skip worktrees used more recently than this.",
            flag=False,
            default=24,
        ),
    ]

    def handle(self):
        return asyncio.run(self.handle_async())

    async def handle_async(self):
        from app.models.Agent import Agent
        from app.models.Project import Project

        dry_run = bool(self.option("dry-run"))
        project_id = self.option("project")
        projects = [await Project.find(int(project_id))] if project_id else await Project.all()
        live_ids = {a.id for a in await Agent.where_null("deleted_at").get()}

        repos = self._repos([p for p in projects if p])
        plans = [
            wc.plan_prune(
                repo,
                live_ids,
                include_external=bool(self.option("include-external")),
                min_age_hours=float(self.option("min-age-hours")),
            )
            for repo in repos
        ]
        return self._run(plans, dry_run)

    def _repos(self, projects) -> list[str]:
        """Main checkout of each project's repo, once per repo (projects can share one)."""
        repos: dict[str, str] = {}
        for project in projects:
            path = os.path.expanduser(project.path)
            if not os.path.isdir(path):
                continue
            common = wc.git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
            top = wc.git(path, "rev-parse", "--show-toplevel")
            if common.returncode == 0 and top.returncode == 0:
                repos.setdefault(common.stdout.strip(), top.stdout.strip())
        return list(repos.values())

    def _run(self, plans: list[wc.PrunePlan], dry_run: bool) -> int:
        verb = "WOULD REMOVE" if dry_run else "REMOVE"
        rows = []
        removed_kb = removed = skipped = failed = 0
        for plan in plans:
            for c in sorted(plan.candidates, key=lambda c: not c.assessment.removable):
                wt = c.worktree
                if c.assessment.removable:
                    note = ""
                    if not dry_run:
                        result = wc.remove(plan.repo, wt)
                        if not result.removed:
                            failed += 1
                            rows.append(("FAILED", c, result.error or ""))
                            continue
                        note = result.error or ""
                    removed += 1
                    removed_kb += c.size_kb
                    rows.append((verb, c, note))
                else:
                    skipped += 1
                    rows.append(("SKIP", c, "; ".join(c.assessment.reasons)))

        self._table(rows)

        missing = sum(len(p.missing) for p in plans)
        if missing:
            self.line(f"\n<comment>{missing} registered worktrees have no directory</comment>")
            for plan in plans:
                for wt in plan.missing:
                    self.line(f"  {wt.path}")
                if plan.missing and not dry_run:
                    for line in wc.prune_missing(plan.repo):
                        self.line(f"  git: {line}")

        self._claude_dirs([c for _, c, _ in rows])

        external = sum(p.external for p in plans)
        self.line("")
        self.line(
            f"<info>{'Would remove' if dry_run else 'Removed'} {removed} worktrees "
            f"({_size(removed_kb)} reclaimed)</info>, skipped {skipped}, failed {failed}, "
            f"{'would prune' if dry_run else 'pruned'} {missing} missing."
        )
        if external:
            self.line(
                f"{external} worktrees outside .claude/worktrees and .worktrees ignored (--include-external)."
            )
        if dry_run:
            self.line("Dry run: nothing was changed.")
        return 1 if failed else 0

    def _table(self, rows) -> None:
        header = ("ACTION", "SIZE", "DIRTY", "UNPUSHED", "OWNER", "BRANCH", "PATH", "REASON")
        cells = [
            (
                action,
                _size(c.size_kb),
                str(c.assessment.dirty),
                str(c.assessment.unpushed),
                c.owner,
                c.worktree.branch or "(detached)",
                c.worktree.path,
                reason,
            )
            for action, c, reason in rows
        ]
        widths = [max(len(r[i]) for r in [header, *cells]) for i in range(len(header) - 1)]
        for row in [header, *cells]:
            self.line("  ".join(v.ljust(w) for v, w in zip(row, widths)) + "  " + row[-1])

    def _claude_dirs(self, candidates) -> None:
        """List (never delete) Claude CLI session transcripts kept for these worktrees."""
        found = [
            (d, wc.disk_kb(d))
            for d in (wc.claude_project_dir(c.worktree.path) for c in candidates)
            if os.path.isdir(d)
        ]
        if not found:
            return
        total = sum(kb for _, kb in found)
        self.line(
            f"\n~/.claude/projects session dirs for these worktrees ({len(found)}, {_size(total)}), listed only, never deleted:"
        )
        for d, kb in found:
            self.line(f"  {_size(kb):>7}  {d}")
