FROM mcr.microsoft.com/playwright:v1.63.0-noble

LABEL org.opencontainers.image.source=https://github.com/pepperhorn/ph-scoreview
LABEL org.opencontainers.image.description="PepperScore CI image with Playwright browsers and Poppler PDF tools"

RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*
