import { Request, Response } from "express";
import { appDatabase } from "../utils/database.util";
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
    })().catch((err) => {
      tableReady = null;
      throw err;
    });
  }
  await tableReady;
}

function asString(value: unknown, max = 1024): string | null {
  if (value == null) return null;
  const s = String(value);
  if (!s) return null;
  return s.slice(0, max);
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
      const ip =
        asString(req.headers["x-forwarded-for"], 64)?.split(",")[0]?.trim() ||
        asString(req.socket.remoteAddress, 64);

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
          asString(body.visitor_id, 64),
          asString(body.page_path, 512),
          asString(body.page_url, 1024),
          asString(body.referrer || attribution.referrer, 1024),
          asString(attribution.utm_source, 128),
          asString(attribution.utm_medium, 128),
          asString(attribution.utm_campaign, 256),
          asString(attribution.utm_content, 256),
          asString(attribution.utm_term, 256),
          asString(attribution.rdt_cid, 256),
          asString(attribution.gclid, 256),
          asString(attribution.fbclid, 256),
          JSON.stringify(body.props || {}),
          asString(body.user_agent || req.headers["user-agent"], 512),
          ip,
        ],
      );

      return res.status(204).end();
    } catch (error: any) {
      logger.error(`[LandingEvents] ${error?.message || error}`);
      return res.status(500).json({ ok: false, message: "Failed to record event" });
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
        `SELECT COUNT(DISTINCT visitorId) AS visitors
         FROM landing_page_events
         WHERE site = ?
           AND createdAt >= (NOW() - INTERVAL ? DAY)`,
        [site, days],
      );

      return res.json({
        ok: true,
        site,
        days,
        visitors: Number(visitors?.[0]?.visitors || 0),
        events: rows,
      });
    } catch (error: any) {
      logger.error(`[LandingEvents][summary] ${error?.message || error}`);
      return res.status(500).json({ ok: false, message: "Failed to load summary" });
    }
  };
}
