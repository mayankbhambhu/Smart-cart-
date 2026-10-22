from typing import Any


class ApiError(Exception):
    """An error the client can act on, sent as {"error": code, ...details}."""

    def __init__(self, status: int, code: str, /, **details: Any) -> None:
        super().__init__(code)
        self.status = status
        self.code = code
        self.details = details
