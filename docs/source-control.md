# Source Control branch changes

Source Control keeps staged and working-tree files in their existing sections. The
“Committed on this branch” section compares the current HEAD with its merge-base
against the selected base. It counts commits reachable from HEAD but not the base,
independently of the upstream push/pull counts in the toolbar. A push therefore
keeps committed files visible until they are merged into the base.

Base resolution uses local Git refs without a network request, in this order:

1. Local `dev`, then remote `dev` (`origin` first).
2. A remote's symbolic default branch (`origin/HEAD` first), preferring its local
   counterpart when available.
3. Local `main` or `master`, then their remote counterparts.
4. The checked-out branch's configured upstream.

The base branch itself has zero commits ahead. Detached HEAD still compares its
commit against the resolved base. An unborn branch, a repository without a base,
or unrelated histories display an explanation instead of claiming the branch is
clean. Remote refs reflect the last fetch; this view does not fetch automatically.

Clicking a committed file compares committed blobs at the merge-base and HEAD,
including renames, additions, and deletions. It excludes staged and working-tree
edits. Binary files and sides above the editor's 1 MB limit use its existing
placeholders. Worktree selection scopes the comparison and diff to that checkout.

Commit and push refresh the comparison and open diffs immediately, including on
failure because hooks or remote operations may have changed state. The existing
circular refresh button and window focus also refresh the comparison. No Pull
operation is introduced by this change.
