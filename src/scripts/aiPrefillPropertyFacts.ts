import "dotenv/config";
import OpenAI from "openai";
import { In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import logger from "../utils/logger.utils";
import { PropertyFactsService } from "../services/PropertyFactsService";
import { ListingGroupService } from "../services/ListingGroupService";
import { ListingKnowledgeService } from "../services/ListingKnowledgeService";
import { Listing } from "../entity/Listing";
import { ListingIntake } from "../entity/ListingIntake";
import { AILearnedFactEntity } from "../entity/AILearnedFact";
import { PROPERTY_FACT_FIELDS } from "../config/propertyFactFields";

/**
 * AI prefill for the Verified Property Facts sheet.
 *
 * The deterministic prefill (prefillPropertyFacts.ts) only maps a handful of
 * structured columns. This script fills the REST of the catalog by handing
 * everything we already know about each property — listing description,
 * Knowledge Base entries (which carry the Hostify amenities / house rules),
 * approved learned facts distilled from real guest conversations, and the
 * intake form — to the LLM and asking it to fill ONLY the still-empty fields.
 *
 * Everything lands UNVERIFIED with source "ai_prefill" and never overwrites
 * an existing value, so the team confirms in Review Mode instead of typing
 * from scratch. Idempotent; safe to re-run after knowledge grows.
 *
 * Usage:
 *   npx ts-node src/scripts/aiPrefillPropertyFacts.ts
 *   npx ts-node src/scripts/aiPrefillPropertyFacts.ts --listing=300017579
 *   npx ts-node src/scripts/aiPrefillPropertyFacts.ts --limit=10 --dry-run
 */

const args = process.argv.slice(2);
const argValue = (name: string): string | null => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.split("=").slice(1).join("=") : null;
};
const DRY_RUN = args.includes("--dry-run");
const ONLY_LISTING = argValue("listing") ? Number(argValue("listing")) : null;
const LIMIT = argValue("limit") ? Number(argValue("limit")) : null;
const CONCURRENCY = Math.max(1, Number(argValue("concurrency") || 3));
const MODEL = process.env.AI_MESSAGING_MODEL || "gpt-4.1";

const hourLabel = (h: unknown): string | null => {
    const n = Number(h);
    if (!Number.isFinite(n) || n < 0 || n > 23) return null;
    const ampm = n >= 12 ? "PM" : "AM";
    const display = n % 12 === 0 ? 12 : n % 12;
    return `${display}:00 ${ampm}`;
};

const money = (v: unknown): string | null => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
};

const clip = (s: unknown, max: number): string =>
    String(s ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max);

/** Compile every knowledge source for one property group into plain text. */
async function gatherKnowledge(
    canonical: number,
    groupIds: number[],
    portfolioFacts: AILearnedFactEntity[]
): Promise<string> {
    const sections: string[] = [];

    const listings = await appDatabase.getRepository(Listing).find({
        where: { id: In(groupIds) as any },
        withDeleted: true,
    });
    for (const l of listings) {
        const lines = [
            `### LISTING ${l.id}: ${l.internalListingName || l.name || ""}`,
            l.propertyType ? `Type: ${l.propertyType}` : null,
            l.city || l.state ? `Location: ${[l.city, l.state].filter(Boolean).join(", ")}` : null,
            l.bedroomsNumber != null ? `Bedrooms: ${l.bedroomsNumber}, bathrooms: ${l.bathroomsNumber ?? "?"}` : null,
            l.personCapacity ? `Capacity: ${l.personCapacity} guests (guestsIncluded: ${l.guestsIncluded ?? "?"})` : null,
            hourLabel(l.checkInTimeStart)
                ? `Check-in from ${hourLabel(l.checkInTimeStart)}${hourLabel(l.checkInTimeEnd) ? ` to ${hourLabel(l.checkInTimeEnd)}` : ""}`
                : null,
            hourLabel(l.checkOutTime) ? `Check-out: ${hourLabel(l.checkOutTime)}` : null,
            money(l.cleaningFee) ? `Cleaning fee: ${money(l.cleaningFee)}` : null,
            money(l.priceForExtraPerson) ? `Extra person fee: ${money(l.priceForExtraPerson)} per night` : null,
            money(l.airbnbPetFeeAmount) ? `Airbnb pet fee: ${money(l.airbnbPetFeeAmount)}` : null,
            l.minNights ? `Min nights: ${l.minNights}${l.maxNights ? `, max nights: ${l.maxNights}` : ""}` : null,
            l.wifiUsername ? `WiFi network: ${l.wifiUsername}${l.wifiPassword ? `, password: ${l.wifiPassword}` : ""}` : null,
            l.description ? `Description: ${clip(l.description, 3000)}` : null,
        ].filter(Boolean);
        sections.push(lines.join("\n"));
    }

    const kb = await new ListingKnowledgeService()
        .list(canonical, { includeGroup: true })
        .catch(() => [] as any[]);
    if (kb.length) {
        const lines = ["### KNOWLEDGE BASE"];
        let budget = 14000;
        for (const e of kb) {
            const entry = `[${e.category || "general"}] ${clip(e.title, 150)}: ${clip(e.content, 1200)}`;
            if (budget - entry.length < 0) break;
            budget -= entry.length;
            lines.push(entry);
        }
        sections.push(lines.join("\n"));
    }

    const learned = await appDatabase.getRepository(AILearnedFactEntity).find({
        where: { listingId: In(groupIds) as any, status: "approved" },
        order: { frequency: "DESC" },
        take: 150,
    });
    const qa = [...learned, ...portfolioFacts].filter((f) => (f.factType || "qa") === "qa");
    if (qa.length) {
        const lines = ["### LEARNED FACTS (approved, distilled from real guest conversations)"];
        for (const f of qa) {
            lines.push(
                `${f.scope === "portfolio" ? "[all properties] " : ""}${f.topic ? `(${clip(f.topic, 60)}) ` : ""}${f.question ? `Q: ${clip(f.question, 200)} ` : ""}A: ${clip(f.answer, 600)}`
            );
        }
        sections.push(lines.join("\n"));
    }

    const intake = await appDatabase.getRepository(ListingIntake).findOne({
        where: { listingId: In(groupIds) as any },
        order: { id: "DESC" },
    });
    if (intake) {
        const lines = [
            "### INTAKE FORM (owner-provided)",
            intake.houseRules ? `House rules: ${clip(intake.houseRules, 2000)}` : null,
            intake.cancellationPolicy ? `Cancellation policy: ${clip(intake.cancellationPolicy, 300)}` : null,
            intake.amenities ? `Amenities: ${clip(intake.amenities, 2000)}` : null,
            intake.airbnbAccess ? `Access notes: ${clip(intake.airbnbAccess, 800)}` : null,
            intake.airbnbTransit ? `Transit/parking notes: ${clip(intake.airbnbTransit, 800)}` : null,
            intake.airbnbNotes ? `Other notes: ${clip(intake.airbnbNotes, 800)}` : null,
        ].filter(Boolean);
        if (lines.length > 1) sections.push(lines.join("\n"));
    }

    return sections.join("\n\n").slice(0, 28000);
}

async function extractFacts(
    openai: OpenAI,
    knowledge: string,
    missing: { key: string; label: string; hint?: string }[]
): Promise<Map<string, string>> {
    const fieldList = missing
        .map((f) => `${f.key} — ${f.label}${f.hint ? ` (${f.hint})` : ""}`)
        .join("\n");
    const resp = await openai.chat.completions.create({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
            {
                role: "system",
                content: [
                    "You are filling a short-term-rental property fact sheet that has FIXED preset fields, using ONLY the source material provided about THIS property.",
                    "Rules:",
                    "- Only fill fields from the MISSING FIELDS list below.",
                    "- Only fill a field when the source material CLEARLY states the answer. Never guess, never use general knowledge, and never infer from absence (e.g. do NOT write 'No pets allowed' just because pets are not mentioned).",
                    "- Each value must be concise, self-contained, and guest-shareable. Include fee structure (per night vs flat, per hour) whenever fees are involved.",
                    "- Only STABLE facts (fees, policies, amenities, capacities, schedules). NEVER reservation-specific info, one-off decisions, or guest personal data.",
                    "- Skip every field the material does not answer. An empty list is a fine answer.",
                    `MISSING FIELDS:\n${fieldList}`,
                    'Respond with STRICT JSON only: {"facts":[{"field":"<preset key>","value":"<concise value>"}]}',
                ].join("\n"),
            },
            { role: "user", content: `SOURCE MATERIAL:\n${knowledge}` },
        ],
    });
    const out = new Map<string, string>();
    try {
        const parsed = JSON.parse(resp.choices?.[0]?.message?.content || "{}");
        const facts: { field?: string; value?: string }[] = Array.isArray(parsed?.facts) ? parsed.facts : [];
        const allowed = new Set(missing.map((f) => f.key));
        for (const f of facts) {
            const key = String(f?.field || "");
            const value = String(f?.value || "").trim();
            if (allowed.has(key) && value) out.set(key, value);
        }
    } catch {
        /* malformed JSON → treat as no extractions */
    }
    return out;
}

async function main() {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");
    await appDatabase.initialize();
    const pf = new PropertyFactsService();
    const groups = new ListingGroupService();
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Candidate canonical listing ids: every listing_info row plus every
    // group id we've ever mapped (covers channel children with conversations
    // but no listing_info row).
    let canonicals: number[];
    if (ONLY_LISTING) {
        canonicals = [await pf.canonicalId(ONLY_LISTING)];
    } else {
        const fromListings: any[] = await appDatabase.query(`SELECT id FROM listing_info`);
        const fromMap: any[] = await appDatabase
            .query(`SELECT DISTINCT groupId AS id FROM listing_group_map`)
            .catch(() => []);
        const set = new Set<number>();
        for (const r of [...fromListings, ...fromMap]) {
            const canonical = await groups.resolve(Number(r.id));
            if (canonical) set.add(canonical);
        }
        canonicals = [...set].sort((a, b) => a - b);
    }
    if (LIMIT) canonicals = canonicals.slice(0, LIMIT);
    logger.info(`[ai-prefill] ${canonicals.length} properties to process (model=${MODEL}, dryRun=${DRY_RUN})`);

    const portfolioFacts = await appDatabase.getRepository(AILearnedFactEntity).find({
        where: { scope: "portfolio", status: "approved" },
        take: 100,
    });

    let processed = 0;
    let written = 0;
    let skippedNoKnowledge = 0;

    const worker = async (canonical: number) => {
        try {
            const { facts, catalog } = await pf.getForListing(canonical);
            const filled = new Set(
                facts.filter((f) => f.value && f.value.trim()).map((f) => f.fieldKey)
            );
            const missing = catalog.filter((f) => !filled.has(f.key));
            if (!missing.length) return;

            const groupIds = await groups.groupIds(canonical);
            const knowledge = await gatherKnowledge(canonical, groupIds, portfolioFacts);
            if (knowledge.length < 200) {
                skippedNoKnowledge++;
                return;
            }

            const extracted = await extractFacts(openai, knowledge, missing);
            for (const [key, value] of extracted) {
                if (DRY_RUN) {
                    logger.info(`[ai-prefill] (dry) ${canonical}/${key} = ${value.slice(0, 120)}`);
                    written++;
                    continue;
                }
                await pf.upsert({
                    listingId: canonical,
                    fieldKey: key,
                    value,
                    source: "ai_prefill",
                    verified: false,
                    onlyIfEmpty: true,
                });
                written++;
            }
            if (extracted.size) {
                logger.info(
                    `[ai-prefill] listing ${canonical}: ${extracted.size} field(s) filled (${missing.length} were missing)`
                );
            }
        } catch (err: any) {
            logger.warn(`[ai-prefill] listing ${canonical} failed: ${err.message}`);
        } finally {
            processed++;
            if (processed % 25 === 0) {
                logger.info(`[ai-prefill] progress ${processed}/${canonicals.length}, ${written} values so far`);
            }
        }
    };

    // Small worker pool: one LLM call per property.
    const queue = [...canonicals];
    await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
            for (let id = queue.shift(); id != null; id = queue.shift()) {
                await worker(id);
            }
        })
    );

    logger.info(
        `[ai-prefill] done — ${written} field values ${DRY_RUN ? "would be " : ""}written (unverified, existing values untouched); ` +
            `${skippedNoKnowledge} properties skipped for lack of source material`
    );
    await appDatabase.destroy();
}

main().catch((err) => {
    logger.error(`[ai-prefill] failed: ${err.message}`);
    process.exit(1);
});
