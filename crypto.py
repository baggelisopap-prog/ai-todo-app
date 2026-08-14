"""
Encryption for stored third-party credentials.

A Hostaway client secret is not a password to this app — it is full API
access to someone else's property management system: reservations, guest
names, emails, phone numbers. Storing it the way google_calendar_connections
stores Google tokens (in the clear) is defensible for the owner's own
credentials and not defensible for a second business's.

The key is read on EVERY call rather than at import, so a deploy without
HOSTAWAY_ENCRYPTION_KEY still boots and still serves every user who has no
Hostaway connection. Only the Hostaway paths fail, and they say why.

No new dependency: `cryptography` is already declared in requirements.txt,
pulled in by pywebpush. That file is UTF-16LE and must not be edited.
"""
import os

from cryptography.fernet import Fernet

_ENV_VAR = "HOSTAWAY_ENCRYPTION_KEY"


def generate_key() -> str:
    """A new key, for setting the environment variable once. Not used at runtime."""
    return Fernet.generate_key().decode()


def _cipher() -> Fernet:
    key = os.getenv(_ENV_VAR)
    if not key:
        raise RuntimeError(
            f"{_ENV_VAR} is not set. Generate one with "
            f"crypto.generate_key() and add it to the environment."
        )
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _cipher().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    return _cipher().decrypt(ciphertext.encode()).decode()
