#!/usr/bin/env python3
"""Create paused Reddit Lead Gen forms + ads for Luxury Lodging / SecureStay.

Requires REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN in env/.env.
Creates everything as PAUSED so spend does not start until approved in Ads Manager.
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

API = "https://ads-api.reddit.com/api/v3"
TOKEN_URL = "https://www.reddit.com/api/v1/access_token"
PRIVACY_URL = os.environ.get("REDDIT_PRIVACY_URL", "https://luxurylodgingpm.com/privacy")
PUBLIC_CREATIVE_BASE = os.environ.get(
    "REDDIT_CREATIVE_BASE",
    "https://securestay.ai/securestay_api/public/reddit-ads",
)
DAILY_BUDGET_DOLLARS = float(os.environ.get("REDDIT_DAILY_BUDGET", "50"))
USER_AGENT = os.environ.get("REDDIT_USER_AGENT", "web:securestay-atlas:v1.0.0 (by /u/luxurylodging)")


def load_dotenv() -> None:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def http(
    method: str,
    url: str,
    *,
    headers: Optional[Dict[str, str]] = None,
    data: Any = None,
    form: Optional[Dict[str, str]] = None,
    basic: Optional[tuple] = None,
) -> Any:
    body = None
    req_headers = {"User-Agent": USER_AGENT, **(headers or {})}
    if form is not None:
        body = urllib.parse.urlencode(form).encode()
        req_headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif data is not None:
        body = json.dumps(data).encode()
        req_headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    if basic:
        import base64

        token = base64.b64encode(f"{basic[0]}:{basic[1]}".encode()).decode()
        req.add_header("Authorization", f"Basic {token}")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        err_body = e.read().decode(errors="replace")
        raise RuntimeError(f"{method} {url} -> {e.code}: {err_body}") from e


def get_access_token() -> str:
    client_id = os.environ["REDDIT_CLIENT_ID"]
    client_secret = os.environ["REDDIT_CLIENT_SECRET"]
    refresh = os.environ.get("REDDIT_REFRESH_TOKEN", "").strip()
    if not refresh:
        raise SystemExit(
            "Missing REDDIT_REFRESH_TOKEN. Visit "
            "https://securestay.ai/securestay_api/oauth/reddit/authorize and Allow, then re-run."
        )
    token = http(
        "POST",
        TOKEN_URL,
        form={"grant_type": "refresh_token", "refresh_token": refresh},
        basic=(client_id, client_secret),
    )
    access = token.get("access_token")
    if not access:
        raise RuntimeError(f"Token refresh failed: {token}")
    if token.get("refresh_token"):
        # Rotate if Reddit returns a new refresh token
        os.environ["REDDIT_REFRESH_TOKEN"] = token["refresh_token"]
    return access


class RedditAds:
    def __init__(self, access_token: str):
        self.access_token = access_token

    def call(self, method: str, path: str, data: Any = None) -> Any:
        url = f"{API}{path}"
        return http(
            method,
            url,
            headers={"Authorization": f"Bearer {self.access_token}"},
            data=data,
        )

    def get(self, path: str) -> Any:
        return self.call("GET", path)

    def post(self, path: str, data: Any) -> Any:
        return self.call("POST", path, data=data)


def first_id(payload: Any, *keys: str) -> Optional[str]:
    if not isinstance(payload, dict):
        return None
    data = payload.get("data", payload)
    if isinstance(data, list) and data:
        item = data[0]
        if isinstance(item, dict):
            for k in keys:
                if item.get(k):
                    return str(item[k])
            if item.get("id"):
                return str(item["id"])
    if isinstance(data, dict):
        for k in keys:
            if data.get(k):
                return str(data[k])
        if data.get("id"):
            return str(data["id"])
    return None


def list_all(client: RedditAds, path: str) -> List[dict]:
    items: List[dict] = []
    url_path = path
    while url_path:
        if url_path.startswith("http"):
            # pagination absolute URL
            payload = http(
                "GET",
                url_path,
                headers={"Authorization": f"Bearer {client.access_token}"},
            )
        else:
            payload = client.get(url_path)
        data = payload.get("data", [])
        if isinstance(data, list):
            items.extend([x for x in data if isinstance(x, dict)])
        elif isinstance(data, dict):
            items.append(data)
        next_url = (payload.get("pagination") or {}).get("next_url")
        url_path = next_url
    return items


def create_lead_forms(client: RedditAds, ad_account_id: str) -> Dict[str, str]:
    forms = {
        "general": {
            "name": "LL Host PM — Full Service Lead Form",
            # Reddit enforces max 100 characters on prompt.
            "prompt": "Get a free Airbnb review. Full-service management — earn more, hands-off.",
            "questions": [
                {"type": "FIRST_NAME", "required": True},
                {"type": "LAST_NAME", "required": True},
                {"type": "EMAIL", "required": True},
                {"type": "PHONE_NUMBER", "required": True},
                {"type": "POSTAL_CODE", "required": False},
            ],
        },
        "three_bedroom": {
            "name": "LL Host PM — 3+ Bedroom Qualifier Form",
            "prompt": "3+ bedroom Airbnb owners: get a free review for 15% full-service management.",
            "questions": [
                {"type": "FIRST_NAME", "required": True},
                {"type": "LAST_NAME", "required": True},
                {"type": "EMAIL", "required": True},
                {"type": "PHONE_NUMBER", "required": True},
                {"type": "POSTAL_CODE", "required": False},
            ],
        },
    }

    # Reuse existing forms with the same name if already created
    existing = {f.get("name"): f for f in list_all(client, f"/ad_accounts/{ad_account_id}/lead_gen_forms")}
    result = {}
    for key, form in forms.items():
        if form["name"] in existing and existing[form["name"]].get("id"):
            result[key] = str(existing[form["name"]]["id"])
            print(f"Reusing form {key}: {result[key]}")
            continue
        payload = {
            "data": {
                "name": form["name"],
                "privacy_link": PRIVACY_URL,
                "prompt": form["prompt"],
                "questions": form["questions"],
            }
        }
        created = client.post(f"/ad_accounts/{ad_account_id}/lead_gen_forms", payload)
        form_id = first_id(created)
        if not form_id:
            raise RuntimeError(f"Form create failed for {key}: {created}")
        result[key] = form_id
        print(f"Created form {key}: {form_id}")
        time.sleep(0.5)
    return result


def create_campaign(client: RedditAds, ad_account_id: str) -> str:
    name = "LL Host PM — Reddit Lead Gen (Paused)"
    for c in list_all(client, f"/ad_accounts/{ad_account_id}/campaigns"):
        if c.get("name") == name and c.get("id"):
            print(f"Reusing campaign: {c['id']}")
            return str(c["id"])
    created = client.post(
        f"/ad_accounts/{ad_account_id}/campaigns",
        {
            "data": {
                "name": name,
                "objective": "LEAD_GENERATION",
                "configured_status": "PAUSED",
            }
        },
    )
    campaign_id = first_id(created)
    if not campaign_id:
        raise RuntimeError(f"Campaign create failed: {created}")
    print(f"Created campaign: {campaign_id}")
    return campaign_id


def create_ad_group(
    client: RedditAds,
    ad_account_id: str,
    campaign_id: str,
    *,
    name: str,
    keywords: List[str],
    communities: Optional[List[str]] = None,
    pixel_id: Optional[str] = None,
) -> str:
    for ag in list_all(client, f"/ad_accounts/{ad_account_id}/ad_groups"):
        if ag.get("name") == name and ag.get("id"):
            print(f"Reusing ad group: {ag['id']} ({name})")
            return str(ag["id"])

    start = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    budget_micro = int(DAILY_BUDGET_DOLLARS * 1_000_000)
    targeting: Dict[str, Any] = {
        "geolocations": ["US"],
        "keywords": keywords,
        "expand_targeting": True,
    }
    if communities:
        targeting["communities"] = communities

    # LEAD_GENERATION campaigns currently accept click optimization in Ads API
    # (not optimization_goal=LEAD). Bid is required for CPC.
    bid_value = int(float(os.environ.get("REDDIT_CPC_BID", "1.50")) * 1_000_000)
    data: Dict[str, Any] = {
        "campaign_id": campaign_id,
        "name": name,
        "configured_status": "PAUSED",
        "bid_strategy": "MAXIMIZE_VOLUME",
        "bid_type": "CPC",
        "bid_value": bid_value,
        "goal_type": "DAILY_SPEND",
        "goal_value": budget_micro,
        "start_time": start,
        "optimization_goal": "CLICKS",
        "targeting": targeting,
    }
    if pixel_id:
        data["conversion_pixel_id"] = pixel_id

    attempts = [
        data,
        {k: v for k, v in data.items() if k != "conversion_pixel_id"},
        {
            **{k: v for k, v in data.items() if k != "conversion_pixel_id"},
            "targeting": {k: v for k, v in targeting.items() if k != "communities"},
        },
    ]
    last_err: Optional[Exception] = None
    for attempt in attempts:
        try:
            created = client.post(f"/ad_accounts/{ad_account_id}/ad_groups", {"data": attempt})
            ad_group_id = first_id(created)
            if ad_group_id:
                print(f"Created ad group: {ad_group_id} ({name})")
                return ad_group_id
            last_err = RuntimeError(f"Ad group create failed: {created}")
        except Exception as exc:
            last_err = exc
            print(f"Ad group attempt failed: {exc}", file=sys.stderr)
    raise RuntimeError(f"Ad group create failed after retries: {last_err}")


def create_image_post(
    client: RedditAds,
    profile_id: str,
    *,
    headline: str,
    body: str,
    image_url: str,
    cta: str = "Sign Up",
) -> str:
    # Prefer classic posts API with content media
    payload = {
        "data": {
            "type": "IMAGE",
            "headline": headline,
            "body": body,
            "allow_comments": True,
            "content": [
                {
                    "media_url": image_url,
                    "destination_url": "https://luxurylodgingpm.com",
                    "call_to_action": cta,
                }
            ],
        }
    }
    created = client.post(f"/profiles/{profile_id}/posts", payload)
    post_id = first_id(created)
    if not post_id:
        raise RuntimeError(f"Post create failed: {created}")
    print(f"Created post: {post_id} — {headline[:60]}")
    return post_id


def create_ad(
    client: RedditAds,
    ad_account_id: str,
    ad_group_id: str,
    *,
    name: str,
    post_id: str,
    lead_gen_form_id: Optional[str],
) -> str:
    for ad in list_all(client, f"/ad_accounts/{ad_account_id}/ads"):
        if ad.get("name") == name and ad.get("id"):
            print(f"Reusing ad: {ad['id']} ({name})")
            return str(ad["id"])

    data: Dict[str, Any] = {
        "ad_group_id": ad_group_id,
        "name": name,
        "configured_status": "PAUSED",
        "post_id": post_id,
        "click_url": "https://luxurylodgingpm.com",
        "call_to_action": "Sign Up",
    }
    # Undocumented on some schemas; try attach form for LEAD_GENERATION objective.
    if lead_gen_form_id:
        data["lead_gen_form_id"] = lead_gen_form_id

    try:
        created = client.post(f"/ad_accounts/{ad_account_id}/ads", {"data": data})
    except RuntimeError as e:
        if lead_gen_form_id and "lead_gen_form" in str(e).lower():
            print("Retrying ad create without lead_gen_form_id field...")
            data.pop("lead_gen_form_id", None)
            created = client.post(f"/ad_accounts/{ad_account_id}/ads", {"data": data})
        else:
            raise
    ad_id = first_id(created)
    if not ad_id:
        raise RuntimeError(f"Ad create failed: {created}")
    print(f"Created ad: {ad_id} ({name}) form={lead_gen_form_id}")
    return ad_id


def main() -> int:
    load_dotenv()
    access = get_access_token()
    client = RedditAds(access)

    me = client.get("/me")
    print("Authenticated as:", json.dumps(me.get("data", me), indent=2)[:500])

    businesses = list_all(client, "/me/businesses")
    if not businesses:
        raise SystemExit("No businesses returned for this Reddit user.")
    business = businesses[0]
    business_id = str(business.get("id") or business.get("business_id"))
    print(f"Business: {business.get('name')} ({business_id})")

    ad_accounts = list_all(client, f"/businesses/{business_id}/ad_accounts")
    if not ad_accounts:
        raise SystemExit("No ad accounts found.")
    ad_account = ad_accounts[0]
    ad_account_id = str(ad_account.get("id"))
    print(f"Ad account: {ad_account.get('name')} ({ad_account_id})")

    profiles = list_all(client, f"/ad_accounts/{ad_account_id}/profiles")
    if not profiles:
        profiles = list_all(client, f"/businesses/{business_id}/profiles")
    if not profiles:
        raise SystemExit("No Reddit ads profiles found. Create/claim a profile in Ads Manager first.")
    profile_id = str(profiles[0].get("id"))
    print(f"Profile: {profiles[0].get('name') or profiles[0].get('username')} ({profile_id})")

    pixels = list_all(client, f"/ad_accounts/{ad_account_id}/pixels")
    pixel_id = str(pixels[0]["id"]) if pixels and pixels[0].get("id") else None
    print(f"Pixel: {pixel_id or 'none'}")

    forms = create_lead_forms(client, ad_account_id)
    campaign_id = create_campaign(client, ad_account_id)

    # Keywords act as the closest "3 bedroom" filter Reddit supports via API.
    ag_general = create_ad_group(
        client,
        ad_account_id,
        campaign_id,
        name="USA — Hosts / STR (General)",
        keywords=[
            "airbnb host",
            "airbnb management",
            "vacation rental",
            "short term rental",
            "str host",
            "property management",
            "vrbo host",
        ],
        communities=["AirBnBHosts", "Airbnb", "flipping", "realestateinvesting"],
        pixel_id=pixel_id,
    )
    ag_3br = create_ad_group(
        client,
        ad_account_id,
        campaign_id,
        name="USA — 3+ Bedroom Hosts",
        keywords=[
            "3 bedroom airbnb",
            "three bedroom airbnb",
            "3 bedroom vacation rental",
            "airbnb host",
            "short term rental",
            "vacation rental management",
        ],
        communities=["AirBnBHosts", "Airbnb"],
        pixel_id=pixel_id,
    )

    creatives = [
        {
            "key": "offer_15",
            "ad_group_id": ag_general,
            "form_id": forms["general"],
            "headline": "Full-service Airbnb management for 15%",
            "body": "Sign up this week and lock in 15% full service for your first 12 months (normally ~20%). Earn more. Completely hands-off.",
            "image": f"{PUBLIC_CREATIVE_BASE}/15-percent-offer.png",
            "ad_name": "Ad — 15% Full Service Offer",
        },
        {
            "key": "still_managing",
            "ad_group_id": ag_general,
            "form_id": forms["general"],
            "headline": "Still managing your Airbnb yourself?",
            "body": "Top hosts outsource ops and focus on net income — not midnight guest texts. Get a free property review from Luxury Lodging.",
            "image": f"{PUBLIC_CREATIVE_BASE}/still-managing.png",
            "ad_name": "Ad — Still Managing Yourself",
        },
        {
            "key": "hands_off",
            "ad_group_id": ag_general,
            "form_id": forms["general"],
            "headline": "Stop trading time for guest messages",
            "body": "Hands-off Airbnb management that pays for itself. Guest comms, cleaning, pricing, ops — handled.",
            "image": f"{PUBLIC_CREATIVE_BASE}/hands-off.png",
            "ad_name": "Ad — Hands Off Funnel",
        },
        {
            "key": "three_br",
            "ad_group_id": ag_3br,
            "form_id": forms["three_bedroom"],
            "headline": "3+ bedroom Airbnb? See if 15% full service fits",
            "body": "We specialize in larger homes. Get a free review — tell us about your 3+ bedroom property and we'll tell you straight whether switching makes sense.",
            "image": f"{PUBLIC_CREATIVE_BASE}/15-percent-offer.png",
            "ad_name": "Ad — 3+ Bedroom Qualifier",
        },
    ]

    created_ads = []
    for c in creatives:
        post_id = create_image_post(
            client,
            profile_id,
            headline=c["headline"],
            body=c["body"],
            image_url=c["image"],
            cta="Sign Up",
        )
        ad_id = create_ad(
            client,
            ad_account_id,
            c["ad_group_id"],
            name=c["ad_name"],
            post_id=post_id,
            lead_gen_form_id=c["form_id"],
        )
        created_ads.append({"ad": ad_id, "post": post_id, "form": c["form_id"], "name": c["ad_name"]})
        time.sleep(0.7)

    summary = {
        "business_id": business_id,
        "ad_account_id": ad_account_id,
        "campaign_id": campaign_id,
        "forms": forms,
        "ad_groups": {"general": ag_general, "three_bedroom": ag_3br},
        "ads": created_ads,
        "status": "PAUSED",
        "notes": [
            "All campaigns/ads created PAUSED — turn on in Ads Manager after review.",
            "Reddit lead forms only support standard fields (no custom bedroom dropdown). 3BR qualifier is in form prompt + dedicated ad group/keywords/ad.",
            "If an ad did not auto-link its form, select the matching form on the ad in Ads Manager (forms are already created).",
        ],
    }
    out = Path(__file__).resolve().parents[1] / "public" / "reddit-ads" / "last-create-summary.json"
    out.write_text(json.dumps(summary, indent=2))
    print("\n=== SUMMARY ===")
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
