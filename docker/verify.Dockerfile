# syntax=docker/dockerfile:1

# The verification image. The layout audit measures rendered text, so everything that decides glyph
# metrics is fixed here: the browser build comes from the tagged base, the font set from apt, and
# what the generic families resolve to from fontconfig. A run outside this image measures whatever
# fonts the host happens to hold and is advisory only.
FROM mcr.microsoft.com/playwright:v1.62.1-noble

ENV DEBIAN_FRONTEND=noninteractive

# Node 24 for type stripping: the fixture backend, the audit tooling and the backend itself all run
# from .ts sources with no build step. The base image's own Node version is not relied on.
# The key is stored armored under its .asc name, which apt reads directly. Dearmoring it would pull
# in gnupg, whose postinst fails in this base image with no /dev/tty to talk to.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
        -o /etc/apt/keyrings/nodesource.asc \
    && chmod a+r /etc/apt/keyrings/nodesource.asc \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.asc] https://deb.nodesource.com/node_24.x nodistro main" \
        > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        nodejs \
        fontconfig \
        fonts-noto-core \
        fonts-noto-cjk \
        fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

COPY docker/verify-fonts.conf /etc/fonts/local.conf
RUN fc-cache -f

RUN corepack enable

ENV CI=true

WORKDIR /work
