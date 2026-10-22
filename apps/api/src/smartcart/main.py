"""Entry point: `python -m smartcart.main` (or `uvicorn smartcart.main:app`)."""

import logging

import uvicorn

from .app import create_app
from .config import get_settings

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")
app = create_app(settings)

if __name__ == "__main__":
    uvicorn.run(app, host=settings.host, port=settings.port, log_level=settings.log_level, proxy_headers=True)
