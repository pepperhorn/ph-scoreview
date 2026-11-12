FROM mcr.microsoft.com/playwright:v1.63.0-noble

RUN apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends poppler-utils \
    && rm -rf /var/lib/apt/lists/*
