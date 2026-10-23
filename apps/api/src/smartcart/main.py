"""Entry point: `python -m smartcart.main` (or `uvicorn smartcart.main:app`)."""

import uvicorn

from .app import create_app
from .config import get_settings
from .hardening import configure_logging

settings = get_settings()
configure_logging(settings.log_level, settings.log_format)
app = create_app(settings)

if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port, log_level=settings.log_level, proxy_headers=True)
