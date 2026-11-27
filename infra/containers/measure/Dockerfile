FROM ghcr.io/astral-sh/uv:0.9.5-python3.12-bookworm-slim

RUN useradd --create-home --home-dir /workspace --shell /bin/sh runner \
  && mkdir -p /opt/measure

COPY runner.py /opt/measure/runner.py

ENV UV_NO_CONFIG=1 \
  UV_PYTHON_DOWNLOADS=never

WORKDIR /workspace
USER runner
EXPOSE 3000
CMD ["python3", "/opt/measure/runner.py", "serve"]
