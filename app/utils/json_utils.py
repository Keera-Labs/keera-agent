import json
import os
import tempfile


def atomic_write_json(path: str, data: dict, mode: int | None = None) -> None:
    """Write data to path atomically using a temp file + os.replace.

    The temp file is created 0600; pass `mode` to give the result other permissions.
    """
    dir_name = os.path.dirname(path) or "."
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dir_name)
    try:
        with os.fdopen(tmp_fd, "w") as f:
            if mode is not None:
                os.fchmod(f.fileno(), mode)
            json.dump(data, f, indent=2)
            f.write("\n")
            f.flush()
            # Without this a crash right after the rename can leave an empty file in place.
            os.fsync(f.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
