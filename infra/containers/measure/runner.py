import glob
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

WORKSPACE = os.environ.get("MEASURE_WORKSPACE", "/workspace")
VENV = os.path.join(WORKSPACE, "venv")
REQUIREMENTS_IN = os.path.join(WORKSPACE, "requirements.in")
LOCK = os.path.join(WORKSPACE, "requirements.txt")
MARKER = os.path.join(VENV, ".measure-lock")
CA = os.environ.get("MEASURE_CA", "/etc/cloudflare/certs/cloudflare-containers-ca.crt")
SYSTEM_CA = "/etc/ssl/certs/ca-certificates.crt"
INDEX = "https://pypi.org/simple"
PYTHON = "/usr/local/bin/python3"
TAIL_BYTES = 4096
LOCK_BYTES = 1048576
READ_BYTES = 65536


def envelope(exit_code, timed_out, stdout, stderr_tail):
    return {
        "exit_code": exit_code,
        "timed_out": timed_out,
        "stdout": stdout,
        "stderr_tail": stderr_tail,
    }


def authority():
    return CA if os.path.exists(CA) else SYSTEM_CA


def clean_environment():
    bundle = authority()
    return {
        "PATH": os.path.join(VENV, "bin") + ":/usr/local/bin:/usr/bin:/bin",
        "HOME": WORKSPACE,
        "LANG": "C.UTF-8",
        "SSL_CERT_FILE": bundle,
        "REQUESTS_CA_BUNDLE": bundle,
        "CURL_CA_BUNDLE": bundle,
        "UV_CACHE_DIR": os.path.join(WORKSPACE, ".cache", "uv"),
        "UV_NO_CONFIG": "1",
        "UV_PYTHON_DOWNLOADS": "never",
    }


def drain(stream, kept, limit, keep_tail):
    buffer = bytearray()
    while True:
        chunk = stream.read1(READ_BYTES)
        if not chunk:
            break
        if keep_tail:
            buffer.extend(chunk)
            del buffer[:-limit]
        elif len(buffer) < limit:
            buffer.extend(chunk[: limit - len(buffer)])
    kept.append(bytes(buffer).decode("utf-8", "replace"))


def stop_group(process):
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def execute(argv, timeout_seconds, limit, cwd):
    try:
        process = subprocess.Popen(
            argv,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=clean_environment(),
            cwd=cwd,
            start_new_session=True,
        )
    except OSError as error:
        return envelope(127, False, "", str(error))
    out, err = [], []
    readers = [
        threading.Thread(target=drain, args=(process.stdout, out, limit, False)),
        threading.Thread(target=drain, args=(process.stderr, err, TAIL_BYTES, True)),
    ]
    for reader in readers:
        reader.start()
    timed_out = False
    try:
        exit_code = process.wait(timeout=timeout_seconds)
    except subprocess.TimeoutExpired:
        timed_out = True
        exit_code = None
    stop_group(process)
    process.wait()
    for reader in readers:
        reader.join(5)
    return envelope(exit_code, timed_out, "".join(out), "".join(err))


def refused(message):
    return envelope(2, False, "", message)


def lock(timeout_ms, spec):
    if spec.startswith("-") or "==" not in spec:
        return refused("the package is named as name==version")
    os.makedirs(WORKSPACE, exist_ok=True)
    with open(REQUIREMENTS_IN, "w", encoding="utf-8") as handle:
        handle.write(spec + "\n")
    argv = [
        "uv", "pip", "compile", "--generate-hashes", "--no-header", "--no-annotate",
        "--index-url", INDEX, "--python", PYTHON, "--output-file", LOCK, REQUIREMENTS_IN,
    ]
    result = execute(argv, timeout_ms / 1000, LOCK_BYTES, WORKSPACE)
    if result["exit_code"] != 0:
        return dict(result, stdout="")
    with open(LOCK, encoding="utf-8") as handle:
        return dict(result, stdout=handle.read())


def digest_of(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


def installed(digest):
    if not os.path.exists(MARKER):
        return False
    with open(MARKER, encoding="utf-8") as handle:
        return handle.read().strip() == digest


def trust_container_ca():
    if not os.path.exists(CA):
        return
    with open(CA, encoding="utf-8") as handle:
        authority = handle.read()
    for bundle in glob.glob(os.path.join(VENV, "lib", "python*", "site-packages", "certifi", "cacert.pem")):
        with open(bundle, "a", encoding="utf-8") as handle:
            handle.write("\n" + authority)


def install(timeout_ms):
    digest = digest_of(LOCK)
    if installed(digest):
        return envelope(0, False, "", "")
    shutil.rmtree(VENV, ignore_errors=True)
    deadline = time.monotonic() + timeout_ms / 1000
    made = execute(["uv", "venv", "--python", PYTHON, VENV], timeout_ms / 1000, TAIL_BYTES, WORKSPACE)
    if made["exit_code"] != 0:
        return dict(made, stdout="")
    argv = [
        "uv", "pip", "install", "--require-hashes", "--no-deps", "--index-url", INDEX,
        "--python", os.path.join(VENV, "bin", "python"), "-r", LOCK,
    ]
    done = execute(argv, max(1, deadline - time.monotonic()), TAIL_BYTES, WORKSPACE)
    if done["exit_code"] != 0:
        return dict(done, stdout="")
    trust_container_ca()
    with open(MARKER, "w", encoding="utf-8") as handle:
        handle.write(digest)
    return envelope(0, False, "", "")


def run(timeout_ms, limit, argv):
    name = argv[0] if argv else ""
    tool = os.path.join(VENV, "bin", name)
    if name in ("", ".", "..") or "/" in name or not os.access(tool, os.X_OK):
        return envelope(127, False, "", "the tool %s is not in the installed package" % name)
    workdir = os.path.join(WORKSPACE, "run")
    shutil.rmtree(workdir, ignore_errors=True)
    os.makedirs(workdir)
    return execute([tool] + argv[1:], timeout_ms / 1000, limit, workdir)


class Alive(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, *_):
        pass


def serve():
    HTTPServer(("0.0.0.0", 3000), Alive).serve_forever()


def answer(args):
    command = args[0] if args else ""
    if command == "lock" and len(args) == 3:
        return lock(int(args[1]), args[2])
    if command == "install" and len(args) == 2:
        return install(int(args[1]))
    if command == "run" and len(args) >= 5 and args[3] == "--":
        return run(int(args[1]), int(args[2]), args[4:])
    return None


def main(args):
    if args == ["serve"]:
        serve()
        return 0
    result = answer(args)
    if result is None:
        sys.stderr.write("usage: runner.py lock|install|run|serve\n")
        return 2
    sys.stdout.write(json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
