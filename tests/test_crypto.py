"""A stored Hostaway secret is full API access to someone else's PMS."""
import pytest

import crypto


def test_a_secret_survives_a_round_trip(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    assert crypto.decrypt_secret(crypto.encrypt_secret("s3cret")) == "s3cret"


def test_the_ciphertext_is_not_the_plaintext(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    assert "s3cret" not in crypto.encrypt_secret("s3cret")


def test_a_different_key_cannot_read_it(monkeypatch):
    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    ciphertext = crypto.encrypt_secret("s3cret")

    monkeypatch.setenv("HOSTAWAY_ENCRYPTION_KEY", crypto.generate_key())
    with pytest.raises(Exception):
        crypto.decrypt_secret(ciphertext)


def test_a_missing_key_says_which_variable_is_missing(monkeypatch):
    """The failure a deploy hits. It must name the fix, not say 'None'."""
    monkeypatch.delenv("HOSTAWAY_ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="HOSTAWAY_ENCRYPTION_KEY"):
        crypto.encrypt_secret("s3cret")


def test_importing_without_a_key_does_not_raise(monkeypatch):
    """
    main.py imports this at startup. A user with no Hostaway connection must
    still be able to log in on a deploy where the key was never set.
    """
    monkeypatch.delenv("HOSTAWAY_ENCRYPTION_KEY", raising=False)
    import importlib
    importlib.reload(crypto)  # must not raise
