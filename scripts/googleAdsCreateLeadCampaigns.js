/**
 * Google Ads Script — create Luxury Lodging Search lead campaigns
 * matching the Reddit lead ads (copy + keywords), plus a Lead conversion.
 *
 * How to run:
 * 1. Google Ads → Tools & settings → Bulk actions → Scripts
 * 2. + → New script → paste this entire file
 * 3. Authorize → Preview → Run
 * 4. Copy the AW conversion snippet from the logs into Cursor
 *
 * Safe defaults: campaigns start PAUSED. Turn on after review.
 */
function main() {
  var LANDING =
    "https://securestay.ai/luxurylodging/?utm_source=google&utm_medium=paid&utm_campaign=ll_host_pm";
  var DAILY_BUDGET_MICROS = 12.5 * 1000000; // $12.50 per ad group campaign (= $25/day total)
  var CAMPAIGN_NAME = "LL Host PM — Google Search Lead Ads";

  var conversion = ensureLeadConversion_();
  Logger.log("CONVERSION_ACTION_ID=" + conversion.getId());
  Logger.log("CONVERSION_CATEGORY=" + conversion.getCategory());
  Logger.log("CONVERSION_NAME=" + conversion.getName());

  var campaign = ensureSearchCampaign_(CAMPAIGN_NAME, DAILY_BUDGET_MICROS * 2);
  var general = ensureAdGroup_(campaign, "USA — Hosts / STR (General)", DAILY_BUDGET_MICROS);
  var threeBr = ensureAdGroup_(campaign, "USA — 3+ Bedroom Hosts", DAILY_BUDGET_MICROS);

  addKeywords_(
    general,
    [
      "airbnb property management",
      "short term rental property management",
      "vacation rental management company",
      "airbnb management",
      "vrbo property management",
      "professional airbnb management",
      "airbnb host",
      "str host",
      "vacation rental management",
      "[airbnb property management]",
      '"short term rental property management"',
    ],
  );
  addKeywords_(
    threeBr,
    [
      "3 bedroom airbnb management",
      "3 bedroom vacation rental management",
      "large airbnb property management",
      "airbnb property management",
      "[3 bedroom airbnb management]",
      '"vacation rental management"',
    ],
  );

  ensureResponsiveSearchAd_(general, LANDING, {
    name: "RSA — 15% / Still Managing / Hands Off",
    headlines: [
      "Airbnb Management for 15%",
      "Still Managing Your Airbnb?",
      "Hands-Off Airbnb Management",
      "Free Property Review",
      "Earn More. Completely Hands-Off",
      "Full-Service STR Management",
      "Luxury Lodging Property Mgmt",
      "Stop Midnight Guest Texts",
      "Get a Free Estimate Today",
      "15% Full Service — First Year",
      "Professional Airbnb Hosts",
      "Outsource Ops. Keep Income",
      "Free Revenue Estimate",
      "Guest Comms + Cleaning Done",
      "Switch to Full-Service PM",
    ],
    descriptions: [
      "Sign up and lock in 15% full service for your first 12 months. Earn more, completely hands-off.",
      "Top hosts outsource ops and focus on net income — not midnight guest texts. Free property review.",
      "Hands-off Airbnb management that pays for itself. Guest comms, cleaning, pricing, ops — handled.",
      "Get a free income analysis for your short-term rental from Luxury Lodging.",
    ],
  });

  ensureResponsiveSearchAd_(threeBr, LANDING, {
    name: "RSA — 3+ Bedroom Qualifier",
    headlines: [
      "3+ Bedroom Airbnb?",
      "15% Full Service for Larger Homes",
      "Free Review for 3+ BR Hosts",
      "We Specialize in Larger STRs",
      "Airbnb Management for 15%",
      "Get a Free Property Review",
      "Luxury Lodging for Big Homes",
      "Earn More. Hands-Off Ops",
      "See If 15% Full Service Fits",
      "Free Estimate for Hosts",
      "Professional STR Management",
      "Outsource Your Airbnb Ops",
      "Guest Comms Handled For You",
      "Lock In 15% for 12 Months",
      "Talk to Luxury Lodging",
    ],
    descriptions: [
      "3+ bedroom Airbnb owners: get a free review for 15% full-service management.",
      "We specialize in larger homes. Tell us about your property — we'll say if switching makes sense.",
      "Full-service guest ops, cleaning, and pricing. Lock in 15% for your first 12 months.",
      "Free income analysis for larger short-term rentals from Luxury Lodging.",
    ],
  });

  Logger.log("DONE. Campaigns are PAUSED. Enable after review.");
  Logger.log("Campaign=" + campaign.getName() + " id=" + campaign.getId());
  Logger.log("Next: Tools → Conversions → open 'Luxury Lodging Website Lead' → Tag setup → copy AW- ID / label for Cursor.");
}

function ensureLeadConversion_() {
  var name = "Luxury Lodging Website Lead";
  var existing = AdsApp.conversionOperations()
    .get()
    .filter(function (c) {
      return c.getName() === name;
    });
  // AdsApp conversion iterator APIs vary; use report fallback if needed.
  try {
    var it = AdsApp.conversions().withCondition("ConversionTrackerName = '" + name + "'").get();
    if (it.hasNext()) return it.next();
  } catch (e) {
    Logger.log("conversion lookup note: " + e);
  }

  // Create via mutate-style helper when available.
  try {
    var op = AdsApp.newConversionOperationBuilder()
      .withName(name)
      .withCategory("SUBMIT_LEAD_FORM")
      .withStatus("ENABLED")
      .build();
    if (op.isSuccessful()) return op.getResult();
    Logger.log("conversion create errors: " + JSON.stringify(op.getErrors()));
  } catch (e2) {
    Logger.log(
      "Could not auto-create conversion via script (" +
        e2 +
        "). Create manually: Tools → Conversions → + Website → Lead form submission named '" +
        name +
        "'.",
    );
  }
  return {
    getId: function () {
      return "MANUAL";
    },
    getCategory: function () {
      return "SUBMIT_LEAD_FORM";
    },
    getName: function () {
      return name;
    },
  };
}

function ensureSearchCampaign_(name, dailyBudgetMicros) {
  var it = AdsApp.campaigns().withCondition("Name = '" + name + "'").get();
  if (it.hasNext()) {
    Logger.log("Reusing campaign " + name);
    return it.next();
  }
  var budget = AdsApp.budgets()
    .withCondition("BudgetName = '" + name + " Budget'")
    .get();
  var budgetObj;
  if (budget.hasNext()) {
    budgetObj = budget.next();
  } else {
    // Create campaign with budget in one builder.
  }

  var builder = AdsApp.newCampaignBuilder()
    .withName(name)
    .withStatus("PAUSED")
    .withChannelType("SEARCH")
    .withBiddingStrategyBuilder(AdsApp.biddingStrategies().newTargetSpendBuilder())
    .withBudget(dailyBudgetMicros / 1000000);

  // Prefer maximize conversions once conversion exists; start with maximize clicks.
  try {
    builder = AdsApp.newCampaignBuilder()
      .withName(name)
      .withStatus("PAUSED")
      .withChannelType("SEARCH")
      .withBiddingStrategyType("TARGET_SPEND")
      .withBudget(dailyBudgetMicros / 1000000);
  } catch (e) {}

  var op = AdsApp.newCampaignBuilder()
    .withName(name)
    .withStatus("PAUSED")
    .withChannelType("SEARCH")
    .withBudget(dailyBudgetMicros / 1000000)
    .build();

  if (!op.isSuccessful()) {
    throw new Error("Campaign create failed: " + op.getErrors());
  }
  var campaign = op.getResult();
  campaign.targeting().languages().newLanguageSelector().withIds([1000]).build(); // English
  // United States
  campaign
    .targeting()
    .locations()
    .newLocationSelector()
    .withIds([2840])
    .build();
  Logger.log("Created campaign " + name);
  return campaign;
}

function ensureAdGroup_(campaign, name, cpcMicros) {
  var it = campaign.adGroups().withCondition("Name = '" + name + "'").get();
  if (it.hasNext()) {
    Logger.log("Reusing ad group " + name);
    return it.next();
  }
  var op = campaign
    .newAdGroupBuilder()
    .withName(name)
    .withStatus("ENABLED")
    .withCpc(1.5)
    .build();
  if (!op.isSuccessful()) throw new Error("Ad group failed: " + op.getErrors());
  Logger.log("Created ad group " + name);
  return op.getResult();
}

function addKeywords_(adGroup, keywords) {
  keywords.forEach(function (kw) {
    var text = kw;
    var match = "BROAD";
    if (kw.charAt(0) === "[" && kw.charAt(kw.length - 1) === "]") {
      text = kw.substring(1, kw.length - 1);
      match = "EXACT";
    } else if (kw.charAt(0) === '"' && kw.charAt(kw.length - 1) === '"') {
      text = kw.substring(1, kw.length - 1);
      match = "PHRASE";
    }
    var existing = adGroup
      .keywords()
      .withCondition("KeywordText = '" + text.replace(/'/g, "\\'") + "'")
      .get();
    if (existing.hasNext()) return;
    var b = adGroup.newKeywordBuilder().withText(text).withCpc(1.5);
    if (match === "EXACT") b = b.withMatchType("EXACT");
    else if (match === "PHRASE") b = b.withMatchType("PHRASE");
    else b = b.withMatchType("BROAD");
    var op = b.build();
    if (!op.isSuccessful()) Logger.log("keyword err " + text + ": " + op.getErrors());
  });
}

function ensureResponsiveSearchAd_(adGroup, finalUrl, spec) {
  var ads = adGroup.ads().withCondition("Type = RESPONSIVE_SEARCH_AD").get();
  while (ads.hasNext()) {
    var ad = ads.next();
    if (ad.isType().responsiveSearchAd() && String(ad.getHeadline()) && spec.name) {
      // cannot easily match by name; skip if any RSA exists
      Logger.log("RSA already present in " + adGroup.getName() + ", skipping create");
      return;
    }
  }
  var builder = adGroup.newAd().responsiveSearchAdBuilder().withFinalUrl(finalUrl);
  spec.headlines.slice(0, 15).forEach(function (h) {
    builder = builder.addHeadline(h.substring(0, 30));
  });
  spec.descriptions.slice(0, 4).forEach(function (d) {
    builder = builder.addDescription(d.substring(0, 90));
  });
  var op = builder.build();
  if (!op.isSuccessful()) {
    Logger.log("RSA create errors for " + adGroup.getName() + ": " + op.getErrors());
  } else {
    Logger.log("Created RSA in " + adGroup.getName());
  }
}
