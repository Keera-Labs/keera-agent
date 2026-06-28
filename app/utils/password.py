"""Salted password hashing built on the standard library.

The framework ships a `Hash` facade but no hashing driver is registered, and no
bcrypt/argon2 dependency is installed. PBKDF2-HMAC-SHA256 from `hashlib` gives a
salted, iterated hash with zero new dependencies.
"""

import hashlib
import hmac
import os

_ALGORITHM = "sha256"
_ITERATIONS = 260_000
_SALT_BYTES = 16


def hash_password(plain: str) -> str:
    salt = os.urandom(_SALT_BYTES)
    digest = hashlib.pbkdf2_hmac(_ALGORITHM, plain.encode(), salt, _ITERATIONS)
    return f"pbkdf2_{_ALGORITHM}${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(plain: str, hashed: str) -> bool:
    try:
        _, iterations, salt_hex, digest_hex = hashed.split("$")
        digest = hashlib.pbkdf2_hmac(
            _ALGORITHM, plain.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, AttributeError):
        return False
    return hmac.compare_digest(digest.hex(), digest_hex)
