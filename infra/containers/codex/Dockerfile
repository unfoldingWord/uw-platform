FROM docker.io/cloudflare/sandbox:1.0.0

RUN npm install --global @openai/codex@0.160.0 \
  && useradd --create-home --home-dir /workspace --shell /bin/sh runner

WORKDIR /workspace
USER runner
