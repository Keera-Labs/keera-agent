import shutil
import subprocess

from app.utils.process_env import user_env

REQUIRED_FLAGS = {
    "gemini": ("--approval-mode", "--resume", "--model", "gemini hooks"),
    "agy": ("--dangerously-skip-permissions", "--continue", "--model", "--mode"),
}


def gemini_cli_binary(path: str | None = None) -> str | None:
    path = user_env().get("PATH") if path is None else path
    return next((name for name in REQUIRED_FLAGS if shutil.which(name, path=path)), None)


def validate_gemini_cli(provider: str) -> None:
    if provider != "gemini":
        return
    environment = user_env()
    binary = gemini_cli_binary(environment.get("PATH"))
    if not binary:
        raise RuntimeError(
            "Gemini CLI is missing. Install @google/gemini-cli (gemini) or the Antigravity CLI "
            "(agy) and run it once to authenticate."
        )
    try:
        result = subprocess.run(
            [shutil.which(binary, path=environment.get("PATH")), "--help"],
            capture_output=True,
            text=True,
            env=environment,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(
            f"Gemini CLI ({binary}) could not start. Check its installation and try again."
        ) from exc
    help_text = result.stdout + result.stderr
    if result.returncode or any(flag not in help_text for flag in REQUIRED_FLAGS[binary]):
        raise RuntimeError(
            f"Gemini CLI ({binary}) is unsupported. Update it to a version supporting "
            f"{', '.join(REQUIRED_FLAGS[binary])}."
        )
