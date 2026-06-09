import json
import os
import tempfile


def atomic_write_json(path: str, data: dict) -> None:
    """Write data to path atomically using a temp file + os.replace."""
    dir_name = os.path.dirname(path) or '.'
    tmp_fd, tmp_path = tempfile.mkstemp(dir=dir_name)
    try:
        with os.fdopen(tmp_fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise
