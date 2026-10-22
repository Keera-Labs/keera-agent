import json
import unittest

from app.services.handoff.transcript import PathRewriter, encoded_dir_name

SOURCE_WORKTREE = "/home/alice/code/app/.claude/worktrees/agent-7"
TARGET_WORKTREE = "/srv/keera/app/.claude/worktrees/agent-3"


def rewriter() -> PathRewriter:
    return PathRewriter(
        {
            SOURCE_WORKTREE: TARGET_WORKTREE,
            "/home/alice/code/app": "/srv/keera/app",
            encoded_dir_name(SOURCE_WORKTREE): encoded_dir_name(TARGET_WORKTREE),
            encoded_dir_name("/home/alice/code/app"): encoded_dir_name("/srv/keera/app"),
            "/home/alice": "/home/keera",
        }
    )


class TestTranscriptPathRewriter(unittest.TestCase):
    def test_prefers_the_longest_matching_path(self):
        text = f"cd {SOURCE_WORKTREE}/src && ls /home/alice/code/app/README.md ~ /home/alice/.ssh"
        self.assertEqual(
            rewriter().text(text),
            f"cd {TARGET_WORKTREE}/src && ls /srv/keera/app/README.md ~ /home/keera/.ssh",
        )

    def test_leaves_paths_that_only_share_a_prefix(self):
        text = "/home/alice/code/apple /home/alicex /opt/home/alice"
        self.assertEqual(
            rewriter().text(text), "/home/keera/code/apple /home/alicex /opt/home/alice"
        )

    def test_rewrites_the_encoded_transcript_directory(self):
        source = f"/home/alice/.claude/projects/{encoded_dir_name(SOURCE_WORKTREE)}/s1/tool-results/a.txt"
        expected = f"/home/keera/.claude/projects/{encoded_dir_name(TARGET_WORKTREE)}/s1/tool-results/a.txt"
        self.assertEqual(rewriter().text(source), expected)

    def test_rewrites_the_encoded_project_dir_without_breaking_the_worktree_one(self):
        scratch = "/tmp/claude-1000/-home-alice-code-app/s1/scratchpad"
        worktree_dir = f"projects/{encoded_dir_name(SOURCE_WORKTREE)}/x"
        self.assertEqual(rewriter().text(scratch), "/tmp/claude-1000/-srv-keera-app/s1/scratchpad")
        self.assertEqual(
            rewriter().text(worktree_dir), f"projects/{encoded_dir_name(TARGET_WORKTREE)}/x"
        )

    def test_rewrites_every_string_in_a_jsonl_entry(self):
        entry = {
            "type": "user",
            "cwd": SOURCE_WORKTREE,
            "sessionId": "abc",
            "message": {
                "content": [
                    {"type": "tool_result", "content": f'"{SOURCE_WORKTREE}/a.py"\nline'},
                    {"type": "text", "text": "untouched"},
                ]
            },
            "files": {f"{SOURCE_WORKTREE}/b.py": 3},
            "count": 2,
        }
        rewritten = json.loads(rewriter().jsonl(json.dumps(entry) + "\n"))
        self.assertEqual(rewritten["cwd"], TARGET_WORKTREE)
        self.assertEqual(
            rewritten["message"]["content"][0]["content"], f'"{TARGET_WORKTREE}/a.py"\nline'
        )
        self.assertEqual(rewritten["message"]["content"][1]["text"], "untouched")
        self.assertEqual(rewritten["files"], {f"{TARGET_WORKTREE}/b.py": 3})
        self.assertEqual(rewritten["count"], 2)
        self.assertEqual(rewritten["sessionId"], "abc")

    def test_keeps_line_structure_and_tolerates_non_json_lines(self):
        content = f'{{"cwd": "{SOURCE_WORKTREE}"}}\n\nnot json {SOURCE_WORKTREE}\n{{"a": 1}}'
        lines = rewriter().jsonl(content).split("\n")
        self.assertEqual(len(lines), 4)
        self.assertEqual(json.loads(lines[0]), {"cwd": TARGET_WORKTREE})
        self.assertEqual(lines[1], "")
        self.assertEqual(lines[2], f"not json {TARGET_WORKTREE}")
        self.assertEqual(json.loads(lines[3]), {"a": 1})

    def test_keeps_non_ascii_text_readable(self):
        line = json.dumps({"text": f"नमस्ते {SOURCE_WORKTREE}"}, ensure_ascii=False)
        self.assertIn(f"नमस्ते {TARGET_WORKTREE}", rewriter().jsonl(line))

    def test_identity_mapping_is_a_no_op(self):
        same = PathRewriter({"/a": "/a", "": "/b"})
        self.assertEqual(same.text("/a/b and /b"), "/a/b and /b")


if __name__ == "__main__":
    unittest.main()
