FROM docker.io/library/node:22.12.0-bookworm-slim

RUN apt-get update \
  && apt-get install --yes --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global @openai/codex@0.160.0 \
  && useradd --create-home --home-dir /workspace --shell /bin/sh runner

WORKDIR /workspace
USER runner
EXPOSE 3000
CMD ["node", "-e", "require('node:http').createServer((_, res) => res.end('ok')).listen(3000)"]
