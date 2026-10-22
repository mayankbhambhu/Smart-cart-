import pytest

from smartcart.auth import AuthError, DevTokenVerifier, Identity, bearer_token


def test_bearer_keeps_everything_after_the_scheme() -> None:
    assert bearer_token("Bearer dev:asha:Asha Patil") == "dev:asha:Asha Patil"
    assert bearer_token("bearer abc.def") == "abc.def"
    assert bearer_token("Basic abc") is None
    assert bearer_token(None) is None


async def test_dev_token_has_uid_and_display_name() -> None:
    assert await DevTokenVerifier().verify("dev:asha:Asha Patil") == Identity(uid="asha", name="Asha Patil")
    with pytest.raises(AuthError):
        await DevTokenVerifier().verify("eyJhbGciOi...")
