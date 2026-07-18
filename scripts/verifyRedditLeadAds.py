#!/usr/bin/env python3
"""Verify Reddit lead forms + ads created for Luxury Lodging."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Reuse helpers from create script
sys.path.insert(0, str(Path(__file__).resolve().parent))
from createRedditLeadAds import (  # type: ignore
    RedditAds,
    get_access_token,
    list_all,
    load_dotenv,
)

EXPECTED_FORMS = {
    "LL Host PM — Full Service Lead Form",
    "LL Host PM — 3+ Bedroom Qualifier Form",
}
EXPECTED_CAMPAIGN = "LL Host PM — Reddit Lead Ads (Paused)"
EXPECTED_AD_GROUPS = {
    "USA — Hosts / STR (General)",
    "USA — 3+ Bedroom Hosts",
}
EXPECTED_ADS = {
    "Ad — 15% Full Service Offer",
    "Ad — Still Managing Yourself",
    "Ad — Hands Off Funnel",
    "Ad — 3+ Bedroom Qualifier",
}


def main() -> int:
    load_dotenv()
    client = RedditAds(get_access_token())
    businesses = list_all(client, "/me/businesses")
    business_id = str(businesses[0].get("id"))
    ad_accounts = list_all(client, f"/businesses/{business_id}/ad_accounts")
    ad_account_id = str(ad_accounts[0].get("id"))

    forms = list_all(client, f"/ad_accounts/{ad_account_id}/lead_gen_forms")
    campaigns = list_all(client, f"/ad_accounts/{ad_account_id}/campaigns")
    ad_groups = list_all(client, f"/ad_accounts/{ad_account_id}/ad_groups")
    ads = list_all(client, f"/ad_accounts/{ad_account_id}/ads")

    form_names = {f.get("name") for f in forms}
    campaign = next((c for c in campaigns if c.get("name") == EXPECTED_CAMPAIGN), None)
    ag_names = {g.get("name") for g in ad_groups if not campaign or g.get("campaign_id") == campaign.get("id")}
    our_ads = [a for a in ads if a.get("name") in EXPECTED_ADS]

    report = {
        "ad_account_id": ad_account_id,
        "forms_found": sorted(form_names & EXPECTED_FORMS),
        "forms_missing": sorted(EXPECTED_FORMS - form_names),
        "campaign": None
        if not campaign
        else {
            "id": campaign.get("id"),
            "name": campaign.get("name"),
            "configured_status": campaign.get("configured_status"),
            "effective_status": campaign.get("effective_status"),
            "objective": campaign.get("objective"),
        },
        "ad_groups_found": sorted(ag_names & EXPECTED_AD_GROUPS),
        "ad_groups_missing": sorted(EXPECTED_AD_GROUPS - ag_names),
        "ads": [
            {
                "id": a.get("id"),
                "name": a.get("name"),
                "configured_status": a.get("configured_status"),
                "effective_status": a.get("effective_status"),
                "post_id": a.get("post_id"),
                "lead_gen_form_id": a.get("lead_gen_form_id"),
                "click_url": a.get("click_url"),
            }
            for a in our_ads
        ],
        "ads_missing": sorted(EXPECTED_ADS - {a.get("name") for a in our_ads}),
    }

    ok = (
        not report["forms_missing"]
        and report["campaign"] is not None
        and not report["ad_groups_missing"]
        and not report["ads_missing"]
        and len(report["ads"]) == 4
    )
    report["ok"] = ok
    print(json.dumps(report, indent=2))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
