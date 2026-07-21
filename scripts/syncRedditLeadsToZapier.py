#!/usr/bin/env python3
"""Poll Reddit lead-gen form submissions and forward new ones to Zapier → GHL.

Requires:
  REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN
  REDDIT_OAUTH_SCOPES including adsleadgendownloader (re-authorize once)
  ZAPIER_REDDIT_LEADS_WEBHOOK_URL (Catch Hook URL)

State file tracks already-forwarded lead IDs so runs are idempotent.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

sys.path.insert(0, str(Path(__file__).resolve().parent))
from createRedditLeadAds import (  # type: ignore
    RedditAds,
    get_access_token,
    list_all,
    load_dotenv,
)

FORM_IDS = {
    "general": "73a296d1-3705-43b2-8dcc-0ebc14b18efb",
    "three_bedroom": "8ba5b3ad-c49d-4386-b1ca-d4272d56d2fb",
}
STATE_PATH = Path(__file__).resolve().parents[1] / "public" / "reddit-ads" / "forwarded-leads.json"


def load_state() -> Set[str]:
    if not STATE_PATH.exists():
        return set()
    try:
        data = json.loads(STATE_PATH.read_text())
        return set(data.get("forwarded_ids") or [])
    except Exception:
        return set()


def save_state(ids: Set[str]) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(
        json.dumps({"forwarded_ids": sorted(ids)}, indent=2) + "\n",
        encoding="utf-8",
    )


def lead_id(lead: Dict[str, Any]) -> str:
    for key in ("id", "lead_id", "submission_id"):
        if lead.get(key):
            return str(lead[key])
    # Fallback fingerprint
    parts = [
        str(lead.get("email") or ""),
        str(lead.get("phone_number") or lead.get("phone") or ""),
        str(lead.get("created_at") or lead.get("submitted_at") or ""),
        str(lead.get("form_id") or ""),
    ]
    return "|".join(parts)


def normalize_lead(lead: Dict[str, Any], form_key: str, form_id: str) -> Dict[str, Any]:
    answers = lead.get("answers") or lead.get("questions") or {}
    if isinstance(answers, list):
        mapped: Dict[str, Any] = {}
        for item in answers:
            if not isinstance(item, dict):
                continue
            qtype = str(item.get("type") or item.get("question_type") or "").upper()
            val = item.get("value") or item.get("answer") or item.get("text")
            if qtype:
                mapped[qtype.lower()] = val
        answers = mapped

    def pick(*keys: str) -> Optional[str]:
        for k in keys:
            if lead.get(k) not in (None, ""):
                return str(lead[k])
            if isinstance(answers, dict) and answers.get(k) not in (None, ""):
                return str(answers[k])
        return None

    return {
        "source": "reddit_lead_ads",
        "form_key": form_key,
        "form_id": form_id,
        "form_name": (
            "LL Host PM — 3+ Bedroom Qualifier Form"
            if form_key == "three_bedroom"
            else "LL Host PM — Full Service Lead Form"
        ),
        "lead_id": lead_id(lead),
        "first_name": pick("first_name", "FIRST_NAME"),
        "last_name": pick("last_name", "LAST_NAME"),
        "email": pick("email", "EMAIL"),
        "phone_number": pick("phone_number", "phone", "PHONE_NUMBER"),
        "postal_code": pick("postal_code", "zip", "POSTAL_CODE"),
        "created_at": pick("created_at", "submitted_at"),
        "raw": lead,
    }


def fetch_form_leads(client: RedditAds, form_id: str) -> List[Dict[str, Any]]:
    path = f"/lead_gen_forms/{form_id}/leads"
    try:
        return list_all(client, path)
    except Exception as e:
        msg = str(e)
        if "adsleadgendownloader" in msg or "403" in msg:
            raise SystemExit(
                "Missing Reddit scope adsleadgendownloader. "
                "Visit https://securestay.ai/securestay_api/oauth/reddit/authorize "
                "while logged in as luxury_lodging, Allow, then re-run."
            ) from e
        # Empty forms may 404 on some accounts
        if "404" in msg:
            return []
        raise


def post_to_zapier(webhook: str, payload: Dict[str, Any]) -> None:
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        webhook,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "SecureStay-RedditLeadSync/1.0"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        resp.read()


def main() -> int:
    load_dotenv()
    webhook = str(os.environ.get("ZAPIER_REDDIT_LEADS_WEBHOOK_URL") or "").strip()
    if not webhook:
        raise SystemExit("Set ZAPIER_REDDIT_LEADS_WEBHOOK_URL to your Zapier Catch Hook URL.")

    client = RedditAds(get_access_token())
    seen = load_state()
    forwarded = 0
    scanned = 0

    for form_key, form_id in FORM_IDS.items():
        leads = fetch_form_leads(client, form_id)
        for lead in leads:
            scanned += 1
            payload = normalize_lead(lead if isinstance(lead, dict) else {}, form_key, form_id)
            lid = payload["lead_id"]
            if not lid or lid in seen:
                continue
            post_to_zapier(webhook, payload)
            seen.add(lid)
            forwarded += 1
            print(f"Forwarded lead {lid} ({form_key})")

    save_state(seen)
    print(json.dumps({"scanned": scanned, "forwarded": forwarded, "tracked": len(seen)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
