FROM docker.io/cloudflare/sandbox:1.0.0

RUN npm install --global @anthropic-ai/claude-code@2.1.288 \
  && useradd --create-home --home-dir /workspace --shell /bin/sh runner

WORKDIR /workspace
USER runner
