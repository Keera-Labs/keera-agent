import shutil
import subprocess

from app.utils.process_env import user_env


def validate_gemini_cli(provider: str) -> None:
    if provider != "gemini":
        return
    environment = user_env()
    executable = shutil.which("gemini", path=environment.get("PATH"))
    if not executable:
        raise RuntimeError(
            "Gemini CLI is missing. Install @google/gemini-cli and run gemini to authenticate."
        )
    try:
        result = subprocess.run(
            [executable, "--help"], capture_output=True, text=True, env=environment, timeout=15
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(
            "Gemini CLI could not start. Check its installation and try again."
        ) from exc
    if result.returncode or any(
        flag not in result.stdout
        for flag in ("--approval-mode", "--resume", "--model", "gemini hooks")
    ):
        raise RuntimeError(
            "Gemini CLI is unsupported. Update @google/gemini-cli to a version supporting "
            "--approval-mode, --resume and hooks."
        )
