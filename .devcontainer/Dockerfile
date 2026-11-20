FROM mcr.microsoft.com/devcontainers/typescript-node:24

# The headers the IDE's native modules compile against on install: native-keymap
# (libxkbfile) and keytar (libsecret). The image already has a compiler and Python.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libxkbfile-dev libsecret-1-dev \
    && rm -rf /var/lib/apt/lists/*
