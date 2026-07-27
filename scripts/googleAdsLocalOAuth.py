#!/usr/bin/env python3
"""One-shot local OAuth for Google Ads (desktop client / http://localhost)."""

from __future__ import annotations

import json
import os
import threading
import urllib.parse
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"
PORT = int(os.environ.get("GOOGLE_ADS_LOCAL_OAUTH_PORT", "8787"))
REDIRECT_URI = f"http://localhost:{PORT}/"
SCOPE = "https://www.googleapis.com/auth/adwords"
TOKEN_URL = "https://oauth2.googleapis.com/token"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"


def load_dotenv() -> dict[str, str]:
    env: dict[str, str] = {}
    if not ENV_PATH.exists():
        return env
    for line in ENV_PATH.read_text().splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
        if k.strip() not in os.environ:
            os.environ[k.strip()] = env[k.strip()]
    return env


def upsert_env(key: str, value: str) -> None:
    text = ENV_PATH.read_text() if ENV_PATH.exists() else ""
    lines = text.splitlines()
    found = False
    out = []
    for line in lines:
        if not line or line.strip().startswith("#") or "=" not in line:
            out.append(line)
            continue
        k = line.split("=", 1)[0].strip()
        if k == key:
            out.append(f"{key}={value}")
            found = True
        else:
            out.append(line)
    if not found:
        if out and out[-1] != "":
            out.append("")
        out.append(f"{key}={value}")
    ENV_PATH.write_text("\n".join(out).rstrip() + "\n")


def main() -> int:
    load_dotenv()
    client_id = os.environ.get("GOOGLE_ADS_CLIENT_ID", "").strip()
    client_secret = os.environ.get("GOOGLE_ADS_CLIENT_SECRET", "").strip()
    if not client_id or not client_secret:
        raise SystemExit("Missing GOOGLE_ADS_CLIENT_ID / GOOGLE_ADS_CLIENT_SECRET in .env")

    result: dict[str, str] = {}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            qs = urllib.parse.parse_qs(parsed.query)
            if "code" in qs:
                result["code"] = qs["code"][0]
                body = b"<html><body><h2>Google Ads connected</h2><p>You can close this tab.</p></body></html>"
                self.send_response(200)
            else:
                err = qs.get("error", ["unknown"])[0]
                result["error"] = err
                body = f"<html><body><h2>Auth failed</h2><p>{err}</p></body></html>".encode()
                self.send_response(400)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            threading.Thread(target=self.server.shutdown, daemon=True).start()

        def log_message(self, fmt, *args):  # silence
            return

    server = HTTPServer(("127.0.0.1", PORT), Handler)
    params = {
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
    }
    url = f"{AUTH_URL}?{urllib.parse.urlencode(params)}"
    print(f"Listening on {REDIRECT_URI}")
    print("Opening browser for Google consent...")
    print(url)
    webbrowser.open(url)
    server.serve_forever()

    if result.get("error"):
        raise SystemExit(f"OAuth error: {result['error']}")
    code = result.get("code")
    if not code:
        raise SystemExit("No authorization code received")

    body = urllib.parse.urlencode(
        {
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": REDIRECT_URI,
            "grant_type": "authorization_code",
        }
    ).encode()
    req = urllib.request.Request(
        TOKEN_URL,
        data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        token = json.loads(resp.read().decode())

    refresh = token.get("refresh_token")
    if not refresh:
        print(json.dumps({k: token.get(k) for k in ("token_type", "scope", "expires_in")}, indent=2))
        raise SystemExit("No refresh_token returned. Revoke prior grants and retry with prompt=consent.")

    upsert_env("GOOGLE_ADS_REFRESH_TOKEN", refresh)
    upsert_env("GOOGLE_ADS_REDIRECT_URI", REDIRECT_URI)
    print("Saved GOOGLE_ADS_REFRESH_TOKEN to .env")
    print("scope:", token.get("scope"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
