import { Request, Response } from "express";
import { appDatabase } from "../utils/database.util";
import { RedditConversionsService } from "../services/RedditConversionsService";
import { GoogleAdsConversionsService } from "../services/GoogleAdsConversionsService";
import sendEmail from "../utils/sendEmai";
import logger from "../utils/logger.utils";

let tableReady: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      await appDatabase.query(`
        CREATE TABLE IF NOT EXISTS landing_page_events (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          site VARCHAR(64) NOT NULL,
          eventName VARCHAR(128) NOT NULL,
          sessionId VARCHAR(64) NULL,
          visitorId VARCHAR(64) NULL,
          pagePath VARCHAR(512) NULL,
          pageUrl VARCHAR(1024) NULL,
          referrer VARCHAR(1024) NULL,
          utmSource VARCHAR(128) NULL,
          utmMedium VARCHAR(128) NULL,
          utmCampaign VARCHAR(256) NULL,
          utmContent VARCHAR(256) NULL,
          utmTerm VARCHAR(256) NULL,
          rdtCid VARCHAR(256) NULL,
          gclid VARCHAR(256) NULL,
          fbclid VARCHAR(256) NULL,
          props JSON NULL,
          userAgent VARCHAR(512) NULL,
          ip VARCHAR(64) NULL,
          INDEX idx_landing_events_site_created (site, createdAt),
          INDEX idx_landing_events_event (eventName),
          INDEX idx_landing_events_visitor (visitorId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);

      await appDatabase.query(`
        CREATE TABLE IF NOT EXISTS landing_page_users (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          site VARCHAR(64) NOT NULL,
          visitorId VARCHAR(64) NOT NULL,
          firstSeenAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          lastSeenAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          eventCount INT UNSIGNED NOT NULL DEFAULT 0,
          pageViewCount INT UNSIGNED NOT NULL DEFAULT 0,
          isLead TINYINT(1) NOT NULL DEFAULT 0,
          leadAt DATETIME(6) NULL,
          leadForm VARCHAR(64) NULL,
          firstName VARCHAR(128) NULL,
          lastName VARCHAR(128) NULL,
          fullName VARCHAR(256) NULL,
          email VARCHAR(256) NULL,
          phone VARCHAR(64) NULL,
          propertyLocation VARCHAR(512) NULL,
          bedrooms VARCHAR(32) NULL,
          message TEXT NULL,
          landingPage VARCHAR(1024) NULL,
          referrer VARCHAR(1024) NULL,
          utmSource VARCHAR(128) NULL,
          utmMedium VARCHAR(128) NULL,
          utmCampaign VARCHAR(256) NULL,
          utmContent VARCHAR(256) NULL,
          utmTerm VARCHAR(256) NULL,
          rdtCid VARCHAR(256) NULL,
          gclid VARCHAR(256) NULL,
          fbclid VARCHAR(256) NULL,
          userAgent VARCHAR(512) NULL,
          lastIp VARCHAR(64) NULL,
          UNIQUE KEY uq_landing_users_site_visitor (site, visitorId),
          INDEX idx_landing_users_site_last (site, lastSeenAt),
          INDEX idx_landing_users_email (email),
          INDEX idx_landing_users_lead (site, isLead, leadAt)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
      `);
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

function asString(value: unknown, max = 1024): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

function propsRecord(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== "object" || Array.isArray(props)) return {};
  return props as Record<string, unknown>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function leadInbox(): string[] {
  const configured = asString(process.env.LANDING_LEAD_EMAIL, 1024);
  if (configured) {
    return configured
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Landing leads should hit the Luxury Lodging inbox, not the generic ops alias.
  return ["admin@luxurylodgingpm.com", "operations@luxurylodgingpm.com"];
}

async function upsertUser(params: {
  site: string;
  visitorId: string | null;
  eventName: string;
  attribution: Record<string, unknown>;
  props: Record<string, unknown>;
  pagePath: string | null;
  referrer: string | null;
  userAgent: string | null;
  ip: string | null;
}): Promise<void> {
  const { site, visitorId, eventName, attribution, props, pagePath, referrer, userAgent, ip } =
    params;
  if (!visitorId) return;

  const isPageView = eventName === "page_view";
  const isLead = eventName === "lead_submit" || eventName === "form_submit";

  const firstName = asString(props.first_name ?? props.firstName, 128);
  const lastName = asString(props.last_name ?? props.lastName, 128);
  const fullName =
    asString(props.full_name ?? props.fullName ?? props.name, 256) ||
    [firstName, lastName].filter(Boolean).join(" ") ||
    null;
  const email = asString(props.email, 256);
  const phone = asString(props.phone, 64);
  const propertyLocation = asString(
    props.property_location ?? props.propertyLocation,
    512,
  );
  const bedrooms = asString(props.bedrooms, 32);
  const message = asString(props.message, 4000);
  const leadForm = asString(props.form, 64);
  const hasContact = Boolean(email || phone || fullName);

  await appDatabase.query(
    `INSERT INTO landing_page_users
      (site, visitorId, firstSeenAt, lastSeenAt, eventCount, pageViewCount,
       isLead, leadAt, leadForm, firstName, lastName, fullName, email, phone,
       propertyLocation, bedrooms, message, landingPage, referrer,
       utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
       rdtCid, gclid, fbclid, userAgent, lastIp)
     VALUES
      (?, ?, NOW(6), NOW(6), 1, ?,
       ?, IF(?, NOW(6), NULL), ?, ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?,
       ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       lastSeenAt = NOW(6),
       eventCount = eventCount + 1,
       pageViewCount = pageViewCount + VALUES(pageViewCount),
       isLead = GREATEST(isLead, VALUES(isLead)),
       leadAt = IF(VALUES(isLead) = 1 AND leadAt IS NULL, NOW(6), leadAt),
       leadForm = COALESCE(VALUES(leadForm), leadForm),
       firstName = COALESCE(VALUES(firstName), firstName),
       lastName = COALESCE(VALUES(lastName), lastName),
       fullName = COALESCE(VALUES(fullName), fullName),
       email = COALESCE(VALUES(email), email),
       phone = COALESCE(VALUES(phone), phone),
       propertyLocation = COALESCE(VALUES(propertyLocation), propertyLocation),
       bedrooms = COALESCE(VALUES(bedrooms), bedrooms),
       message = COALESCE(VALUES(message), message),
       landingPage = COALESCE(landingPage, VALUES(landingPage)),
       referrer = COALESCE(referrer, VALUES(referrer)),
       utmSource = COALESCE(utmSource, VALUES(utmSource)),
       utmMedium = COALESCE(utmMedium, VALUES(utmMedium)),
       utmCampaign = COALESCE(utmCampaign, VALUES(utmCampaign)),
       utmContent = COALESCE(utmContent, VALUES(utmContent)),
       utmTerm = COALESCE(utmTerm, VALUES(utmTerm)),
       rdtCid = COALESCE(rdtCid, VALUES(rdtCid)),
       gclid = COALESCE(gclid, VALUES(gclid)),
       fbclid = COALESCE(fbclid, VALUES(fbclid)),
       userAgent = COALESCE(VALUES(userAgent), userAgent),
       lastIp = COALESCE(VALUES(lastIp), lastIp)`,
    [
      site,
      visitorId,
      isPageView ? 1 : 0,
      isLead && hasContact ? 1 : 0,
      isLead && hasContact ? 1 : 0,
      isLead ? leadForm : null,
      firstName,
      lastName,
      fullName,
      email,
      phone,
      propertyLocation,
      bedrooms,
      message,
      pagePath,
      referrer,
      asString(attribution.utm_source, 128),
      asString(attribution.utm_medium, 128),
      asString(attribution.utm_campaign, 256),
      asString(attribution.utm_content, 256),
      asString(attribution.utm_term, 256),
      asString(attribution.rdt_cid, 256),
      asString(attribution.gclid, 256),
      asString(attribution.fbclid, 256),
      userAgent,
      ip,
    ],
  );
}

export class LandingEventsController {
  /**
   * POST /public/landing-events
   * Public beacon for Luxury Lodging (and future) landing page analytics.
   */
  create = async (req: Request, res: Response) => {
    try {
      await ensureTable();

      const body = req.body || {};
      const attribution = body.attribution || {};
      const eventName = asString(body.event, 128);
      if (!eventName) {
        return res.status(400).json({ ok: false, message: "event is required" });
      }

      const site = asString(body.site, 64) || "luxurylodging";
      const visitorId = asString(body.visitor_id, 64);
      const pagePath = asString(body.page_path, 512);
      const referrer = asString(body.referrer || attribution.referrer, 1024);
      const userAgent = asString(body.user_agent || req.headers["user-agent"], 512);
      const ip =
        asString(req.headers["x-forwarded-for"], 64)?.split(",")[0]?.trim() ||
        asString(req.socket.remoteAddress, 64);
      const props = propsRecord(body.props);

      await appDatabase.query(
        `INSERT INTO landing_page_events
          (site, eventName, sessionId, visitorId, pagePath, pageUrl, referrer,
           utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
           rdtCid, gclid, fbclid, props, userAgent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          site,
          eventName,
          asString(body.session_id, 64),
          visitorId,
          pagePath,
          asString(body.page_url, 1024),
          referrer,
          asString(attribution.utm_source, 128),
          asString(attribution.utm_medium, 128),
          asString(attribution.utm_campaign, 256),
          asString(attribution.utm_content, 256),
          asString(attribution.utm_term, 256),
          asString(attribution.rdt_cid, 256),
          asString(attribution.gclid, 256),
          asString(attribution.fbclid, 256),
          JSON.stringify(props),
          userAgent,
          ip,
        ],
      );

      await upsertUser({
        site,
        visitorId,
        eventName,
        attribution,
        props,
        pagePath,
        referrer,
        userAgent,
        ip,
      });

      // Send conversion signals back to Reddit (pixel + CAPI). Fire-and-forget.
      RedditConversionsService.sendFromLandingEvent({
        eventName,
        conversionId: asString(props.conversion_id ?? body.conversion_id, 128),
        clickId: asString(attribution.rdt_cid ?? props.rdt_cid, 256),
        pageUrl: asString(body.page_url, 1024),
        visitorId,
        email: asString(props.email, 256),
        phone: asString(props.phone, 64),
        ip,
        userAgent,
        rdtUuid: asString(body.rdt_uuid ?? props.rdt_uuid, 256),
        props,
      });

      return res.status(204).end();
    } catch (error: any) {
      logger.error(`[LandingEvents] ${error?.message || error}`);
      return res.status(500).json({ ok: false, message: "Failed to record event" });
    }
  };

  /**
   * POST /public/landing-events/leads
   * Accepts a landing-page lead, emails the inbox, and marks the visitor as a lead.
   */
  createLead = async (req: Request, res: Response) => {
    try {
      await ensureTable();

      const body = req.body || {};
      const attribution = body.attribution || {};
      const site = asString(body.site, 64) || "luxurylodging";
      const form = asString(body.form, 64) || "qualify_modal";
      const visitorId = asString(body.visitor_id, 64);
      const pagePath = asString(body.page_path, 512);
      const referrer = asString(body.referrer || attribution.referrer, 1024);
      const userAgent = asString(body.user_agent || req.headers["user-agent"], 512);
      const ip =
        asString(req.headers["x-forwarded-for"], 64)?.split(",")[0]?.trim() ||
        asString(req.socket.remoteAddress, 64);

      const firstName = asString(body.first_name ?? body.firstName, 128);
      const lastName = asString(body.last_name ?? body.lastName, 128);
      const fullName =
        asString(body.full_name ?? body.fullName ?? body.name, 256) ||
        [firstName, lastName].filter(Boolean).join(" ") ||
        null;
      const email = asString(body.email, 256);
      const phone = asString(body.phone, 64);
      const propertyLocation = asString(
        body.property_location ?? body.propertyLocation,
        512,
      );
      const bedrooms = asString(body.bedrooms, 32);
      const message = asString(body.message, 4000);

      if (!phone) {
        return res.status(400).json({ ok: false, message: "phone is required" });
      }

      const props = {
        form,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        email,
        phone,
        property_location: propertyLocation,
        bedrooms,
        message,
        conversion_id: asString(body.conversion_id, 128),
      };

      await upsertUser({
        site,
        visitorId,
        eventName: "lead_submit",
        attribution,
        props,
        pagePath,
        referrer,
        userAgent,
        ip,
      });

      await appDatabase.query(
        `INSERT INTO landing_page_events
          (site, eventName, sessionId, visitorId, pagePath, pageUrl, referrer,
           utmSource, utmMedium, utmCampaign, utmContent, utmTerm,
           rdtCid, gclid, fbclid, props, userAgent, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          site,
          "lead_email_sent",
          asString(body.session_id, 64),
          visitorId,
          pagePath,
          asString(body.page_url, 1024),
          referrer,
          asString(attribution.utm_source, 128),
          asString(attribution.utm_medium, 128),
          asString(attribution.utm_campaign, 256),
          asString(attribution.utm_content, 256),
          asString(attribution.utm_term, 256),
          asString(attribution.rdt_cid, 256),
          asString(attribution.gclid, 256),
          asString(attribution.fbclid, 256),
          JSON.stringify(props),
          userAgent,
          ip,
        ],
      );

      const subject =
        form === "contact"
          ? "Income analysis request — Luxury Lodging"
          : "Free revenue estimate — Luxury Lodging";

      const rows: Array<[string, string | null]> = [
        ["Form", form],
        ["Name", fullName],
        ["Phone", phone],
        ["Email", email],
        ["Property", propertyLocation],
        ["Bedrooms", bedrooms],
        ["Message", message],
        ["Page", asString(body.page_url, 1024)],
        ["UTM source", asString(attribution.utm_source, 128)],
        ["UTM medium", asString(attribution.utm_medium, 128)],
        ["UTM campaign", asString(attribution.utm_campaign, 256)],
        ["UTM content", asString(attribution.utm_content, 256)],
        ["rdt_cid", asString(attribution.rdt_cid, 256)],
        ["Visitor", visitorId],
      ];

      const html = `
        <div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;color:#111">
          <h2 style="margin:0 0 12px">New Luxury Lodging website lead</h2>
          <table style="border-collapse:collapse;width:100%;max-width:640px">
            ${rows
              .filter(([, value]) => Boolean(value))
              .map(
                ([label, value]) => `
              <tr>
                <td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:700;width:140px;vertical-align:top">${escapeHtml(label)}</td>
                <td style="padding:8px 10px;border-bottom:1px solid #eee;vertical-align:top">${escapeHtml(String(value))}</td>
              </tr>`,
              )
              .join("")}
          </table>
        </div>
      `;

      const from = asString(process.env.EMAIL_FROM, 256) || "noreply@securestay.ai";
      const recipients = leadInbox();
      const sent = await sendEmail(subject, html, from, recipients.join(", "));
      if (!sent) {
        logger.error("[LandingLeads] Email send returned empty result");
        return res.status(502).json({ ok: false, message: "Failed to send lead email" });
      }
      logger.info(`[LandingLeads] Emailed lead to ${recipients.join(", ")}`);

      RedditConversionsService.sendFromLandingEvent({
        eventName: "lead_submit",
        conversionId: asString(body.conversion_id, 128),
        clickId: asString(attribution.rdt_cid, 256),
        pageUrl: asString(body.page_url, 1024),
        visitorId,
        email,
        phone,
        ip,
        userAgent,
        rdtUuid: asString(body.rdt_uuid, 256),
        props,
      });

      // Google Ads click + enhanced conversions (optimize toward real leads).
      GoogleAdsConversionsService.sendLeadConversion({
        conversionId: asString(body.conversion_id, 128),
        gclid: asString(attribution.gclid, 256),
        email,
        phone,
        pageUrl: asString(body.page_url, 1024),
      });

      return res.json({ ok: true });
    } catch (error: any) {
      logger.error(`[LandingLeads] ${error?.message || error}`);
      return res.status(500).json({ ok: false, message: "Failed to submit lead" });
    }
  };

  /**
   * GET /public/landing-events/summary?site=luxurylodging&days=7
   * Lightweight unauthenticated summary for quick checks (no PII).
   */
  summary = async (req: Request, res: Response) => {
    try {
      await ensureTable();
      const site = asString(req.query.site, 64) || "luxurylodging";
      const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);

      const rows = await appDatabase.query(
        `SELECT eventName, COUNT(*) AS count
         FROM landing_page_events
         WHERE site = ?
           AND createdAt >= (NOW() - INTERVAL ? DAY)
         GROUP BY eventName
         ORDER BY count DESC`,
        [site, days],
      );

      const visitors = await appDatabase.query(
        `SELECT COUNT(*) AS visitors,
                SUM(isLead) AS leads,
                SUM(pageViewCount) AS pageViews
         FROM landing_page_users
         WHERE site = ?
           AND lastSeenAt >= (NOW() - INTERVAL ? DAY)`,
        [site, days],
      );

      return res.json({
        ok: true,
        site,
        days,
        visitors: Number(visitors?.[0]?.visitors || 0),
        leads: Number(visitors?.[0]?.leads || 0),
        pageViews: Number(visitors?.[0]?.pageViews || 0),
        events: rows,
      });
    } catch (error: any) {
      logger.error(`[LandingEvents][summary] ${error?.message || error}`);
      return res.status(500).json({ ok: false, message: "Failed to load summary" });
    }
  };
}
