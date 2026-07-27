#!/usr/bin/env python3
"""Create Google Search lead ads mirroring Reddit Luxury Lodging creatives.

Requires in .env:
  GOOGLE_ADS_DEVELOPER_TOKEN   (Basic/Standard access — Test tokens cannot touch prod)
  GOOGLE_ADS_CLIENT_ID / SECRET / REFRESH_TOKEN
  GOOGLE_ADS_CUSTOMER_ID=115-397-7795

Creates PAUSED campaign + 2 ad groups + RSAs + keywords + Lead conversion action.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        if not line or line.strip().startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def client():
    from google.ads.googleads.client import GoogleAdsClient

    cfg = {
        "developer_token": os.environ["GOOGLE_ADS_DEVELOPER_TOKEN"],
        "client_id": os.environ["GOOGLE_ADS_CLIENT_ID"],
        "client_secret": os.environ["GOOGLE_ADS_CLIENT_SECRET"],
        "refresh_token": os.environ["GOOGLE_ADS_REFRESH_TOKEN"],
        "use_proto_plus": True,
    }
    login = os.environ.get("GOOGLE_ADS_LOGIN_CUSTOMER_ID", "").replace("-", "")
    if login:
        cfg["login_customer_id"] = login
    return GoogleAdsClient.load_from_dict(cfg)


def customer_id() -> str:
    return os.environ["GOOGLE_ADS_CUSTOMER_ID"].replace("-", "")


def gaql(ga_service, query: str):
    cid = customer_id()
    return list(ga_service.search(customer_id=cid, query=query))


def ensure_conversion_action(client, ga_service) -> str:
    name = "Luxury Lodging Website Lead"
    rows = gaql(
        ga_service,
        f"""
        SELECT conversion_action.id, conversion_action.name, conversion_action.resource_name
        FROM conversion_action
        WHERE conversion_action.name = '{name}'
        LIMIT 1
        """,
    )
    if rows:
        rn = rows[0].conversion_action.resource_name
        print(f"Reusing conversion action: {rn}")
        return rn

    conv_service = client.get_service("ConversionActionService")
    op = client.get_type("ConversionActionOperation")
    action = op.create
    action.name = name
    action.type_ = client.enums.ConversionActionTypeEnum.WEBPAGE
    action.category = client.enums.ConversionActionCategoryEnum.SUBMIT_LEAD_FORM
    action.status = client.enums.ConversionActionStatusEnum.ENABLED
    action.view_through_lookback_window_days = 1
    action.click_through_lookback_window_days = 30
    action.value_settings.default_value = 1.0
    action.value_settings.always_use_default_value = True

    resp = conv_service.mutate_conversion_actions(
        customer_id=customer_id(), operations=[op]
    )
    rn = resp.results[0].resource_name
    print(f"Created conversion action: {rn}")
    return rn


def ensure_budget(client, ga_service, name: str, daily_dollars: float) -> str:
    rows = gaql(
        ga_service,
        f"""
        SELECT campaign_budget.resource_name, campaign_budget.name
        FROM campaign_budget
        WHERE campaign_budget.name = '{name}'
        LIMIT 1
        """,
    )
    if rows:
        return rows[0].campaign_budget.resource_name

    budget_service = client.get_service("CampaignBudgetService")
    op = client.get_type("CampaignBudgetOperation")
    budget = op.create
    budget.name = name
    budget.amount_micros = int(daily_dollars * 1_000_000)
    budget.delivery_method = client.enums.BudgetDeliveryMethodEnum.STANDARD
    budget.explicitly_shared = False
    resp = budget_service.mutate_campaign_budgets(
        customer_id=customer_id(), operations=[op]
    )
    return resp.results[0].resource_name


def ensure_campaign(client, ga_service, name: str, budget_rn: str) -> str:
    rows = gaql(
        ga_service,
        f"""
        SELECT campaign.id, campaign.resource_name, campaign.name
        FROM campaign
        WHERE campaign.name = '{name}'
        LIMIT 1
        """,
    )
    if rows:
        print(f"Reusing campaign: {rows[0].campaign.resource_name}")
        return rows[0].campaign.resource_name

    campaign_service = client.get_service("CampaignService")
    op = client.get_type("CampaignOperation")
    c = op.create
    c.name = name
    c.advertising_channel_type = client.enums.AdvertisingChannelTypeEnum.SEARCH
    c.status = client.enums.CampaignStatusEnum.PAUSED
    c.campaign_budget = budget_rn
    c.network_settings.target_google_search = True
    c.network_settings.target_search_network = True
    c.network_settings.target_content_network = False
    c.network_settings.target_partner_search_network = False
    # Maximize clicks until lead volume exists; switch to maximize conversions later.
    c.target_spend.cpc_bid_ceiling_micros = int(3.0 * 1_000_000)
    c.contains_eu_political_advertising = (
        client.enums.EuPoliticalAdvertisingStatusEnum.DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING
    )

    resp = campaign_service.mutate_campaigns(customer_id=customer_id(), operations=[op])
    rn = resp.results[0].resource_name
    print(f"Created campaign: {rn}")

    # Geo US + English
    criterion_service = client.get_service("CampaignCriterionService")
    ops = []
    loc = client.get_type("CampaignCriterionOperation")
    loc.create.campaign = rn
    loc.create.location.geo_target_constant = "geoTargetConstants/2840"  # US
    ops.append(loc)
    lang = client.get_type("CampaignCriterionOperation")
    lang.create.campaign = rn
    lang.create.language.language_constant = "languageConstants/1000"  # English
    ops.append(lang)
    criterion_service.mutate_campaign_criteria(customer_id=customer_id(), operations=ops)
    return rn


def ensure_ad_group(client, ga_service, campaign_rn: str, name: str) -> str:
    rows = gaql(
        ga_service,
        f"""
        SELECT ad_group.id, ad_group.resource_name, ad_group.name
        FROM ad_group
        WHERE ad_group.name = '{name}'
          AND campaign.resource_name = '{campaign_rn}'
        LIMIT 1
        """,
    )
    if rows:
        print(f"Reusing ad group: {rows[0].ad_group.resource_name}")
        return rows[0].ad_group.resource_name

    service = client.get_service("AdGroupService")
    op = client.get_type("AdGroupOperation")
    ag = op.create
    ag.name = name
    ag.campaign = campaign_rn
    ag.status = client.enums.AdGroupStatusEnum.ENABLED
    ag.type_ = client.enums.AdGroupTypeEnum.SEARCH_STANDARD
    ag.cpc_bid_micros = int(1.5 * 1_000_000)
    resp = service.mutate_ad_groups(customer_id=customer_id(), operations=[op])
    rn = resp.results[0].resource_name
    print(f"Created ad group: {rn}")
    return rn


def add_keywords(client, ad_group_rn: str, keywords: list[tuple[str, str]]) -> None:
    service = client.get_service("AdGroupCriterionService")
    ops = []
    for text, match in keywords:
        op = client.get_type("AdGroupCriterionOperation")
        crit = op.create
        crit.ad_group = ad_group_rn
        crit.status = client.enums.AdGroupCriterionStatusEnum.ENABLED
        crit.keyword.text = text
        if match == "EXACT":
            crit.keyword.match_type = client.enums.KeywordMatchTypeEnum.EXACT
        elif match == "PHRASE":
            crit.keyword.match_type = client.enums.KeywordMatchTypeEnum.PHRASE
        else:
            crit.keyword.match_type = client.enums.KeywordMatchTypeEnum.BROAD
        ops.append(op)
    if not ops:
        return
    # ignore duplicates
    try:
        service.mutate_ad_group_criteria(customer_id=customer_id(), operations=ops)
        print(f"Added {len(ops)} keywords to {ad_group_rn}")
    except Exception as e:
        print(f"Keyword mutate note: {e}")


def create_rsa(
    client,
    ad_group_rn: str,
    *,
    headlines: list[str],
    descriptions: list[str],
    final_url: str,
) -> None:
    service = client.get_service("AdGroupAdService")
    op = client.get_type("AdGroupAdOperation")
    ad_group_ad = op.create
    ad_group_ad.ad_group = ad_group_rn
    ad_group_ad.status = client.enums.AdGroupAdStatusEnum.ENABLED
    ad = ad_group_ad.ad
    ad.final_urls.append(final_url)
    for h in headlines[:15]:
        asset = client.get_type("AdTextAsset")
        asset.text = h[:30]
        ad.responsive_search_ad.headlines.append(asset)
    for d in descriptions[:4]:
        asset = client.get_type("AdTextAsset")
        asset.text = d[:90]
        ad.responsive_search_ad.descriptions.append(asset)
    try:
        resp = service.mutate_ad_group_ads(customer_id=customer_id(), operations=[op])
        print(f"Created RSA: {resp.results[0].resource_name}")
    except Exception as e:
        print(f"RSA note: {e}")


def main() -> int:
    load_dotenv()
    required = [
        "GOOGLE_ADS_DEVELOPER_TOKEN",
        "GOOGLE_ADS_CLIENT_ID",
        "GOOGLE_ADS_CLIENT_SECRET",
        "GOOGLE_ADS_REFRESH_TOKEN",
        "GOOGLE_ADS_CUSTOMER_ID",
    ]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        raise SystemExit(f"Missing env: {', '.join(missing)}")

    c = client()
    ga = c.get_service("GoogleAdsService")

    # Probe access early for clear errors
    try:
        gaql(ga, "SELECT customer.id FROM customer LIMIT 1")
    except Exception as e:
        msg = str(e)
        if "DEVELOPER_TOKEN_NOT_APPROVED" in msg or "test accounts" in msg.lower():
            print(
                "Developer token is Test-only. In Google Ads → API Center, "
                "Apply for Basic access, then re-run this script."
            )
            return 2
        raise

    conv_rn = ensure_conversion_action(c, ga)
    budget_rn = ensure_budget(c, ga, "LL Host PM Search Budget", 25.0)
    campaign_rn = ensure_campaign(c, ga, "LL Host PM — Google Search Lead Ads", budget_rn)

    general = ensure_ad_group(c, ga, campaign_rn, "USA — Hosts / STR (General)")
    three = ensure_ad_group(c, ga, campaign_rn, "USA — 3+ Bedroom Hosts")

    add_keywords(
        c,
        general,
        [
            ("airbnb property management", "PHRASE"),
            ("short term rental property management", "PHRASE"),
            ("vacation rental management company", "PHRASE"),
            ("airbnb management", "PHRASE"),
            ("vrbo property management", "PHRASE"),
            ("professional airbnb management", "BROAD"),
            ("airbnb host", "PHRASE"),
            ("airbnb property management", "EXACT"),
        ],
    )
    add_keywords(
        c,
        three,
        [
            ("3 bedroom airbnb management", "PHRASE"),
            ("3 bedroom vacation rental", "PHRASE"),
            ("large airbnb property management", "BROAD"),
            ("airbnb property management", "PHRASE"),
            ("3 bedroom airbnb management", "EXACT"),
        ],
    )

    landing = (
        "https://securestay.ai/luxurylodging/"
        "?utm_source=google&utm_medium=paid&utm_campaign=ll_host_pm"
    )
    create_rsa(
        c,
        general,
        headlines=[
            "Airbnb Management for 15%",
            "Still Managing Your Airbnb?",
            "Hands-Off Airbnb Management",
            "Free Property Review",
            "Earn More. Completely Hands-Off",
            "Full-Service STR Management",
            "Luxury Lodging Property Mgmt",
            "Stop Midnight Guest Texts",
            "Get a Free Estimate Today",
            "15% Full Service — 1st Year",
            "Professional Airbnb Hosts",
            "Outsource Ops. Keep Income",
            "Free Revenue Estimate",
            "Guest Comms + Cleaning Done",
            "Switch to Full-Service PM",
        ],
        descriptions=[
            "Lock in 15% full service for your first 12 months. Earn more, completely hands-off.",
            "Top hosts outsource ops and focus on net income — not midnight guest texts.",
            "Hands-off Airbnb management that pays for itself. Guest comms, cleaning, pricing — handled.",
            "Get a free income analysis for your short-term rental from Luxury Lodging.",
        ],
        final_url=landing + "&utm_content=general_rsa",
    )
    create_rsa(
        c,
        three,
        headlines=[
            "3+ Bedroom Airbnb?",
            "15% Full Service Larger Homes",
            "Free Review for 3+ BR Hosts",
            "We Specialize in Larger STRs",
            "Airbnb Management for 15%",
            "Get a Free Property Review",
            "Luxury Lodging for Big Homes",
            "Earn More. Hands-Off Ops",
            "See If 15% Service Fits",
            "Free Estimate for Hosts",
            "Professional STR Management",
            "Outsource Your Airbnb Ops",
            "Guest Comms Handled For You",
            "Lock In 15% for 12 Months",
            "Talk to Luxury Lodging",
        ],
        descriptions=[
            "3+ bedroom Airbnb owners: get a free review for 15% full-service management.",
            "We specialize in larger homes. Tell us about your property — we'll be straight with you.",
            "Full-service guest ops, cleaning, and pricing. Lock in 15% for your first 12 months.",
            "Free income analysis for larger short-term rentals from Luxury Lodging.",
        ],
        final_url=landing + "&utm_content=three_br_rsa",
    )

    summary = {
        "customer_id": customer_id(),
        "conversion_action": conv_rn,
        "campaign": campaign_rn,
        "ad_groups": {"general": general, "three_bedroom": three},
        "daily_budget_dollars": 25,
        "status": "PAUSED",
        "landing": landing,
        "note": "Enable campaign after review. Wire AW conversion tag into luxury-lodging-pm env.",
    }
    out = ROOT / "public" / "google-ads" / "last-create-summary.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))
    print(f"Wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
