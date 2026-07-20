/**
 * Hard-fact ledger for inbox AI — structural wrong_info defense.
 *
 * HARD facts may be stated as certain. SOFT background may only hedge.
 * Claim gate + verifier should ground only against HARD (+ this-thread TEAM).
 */

export type HardFactKind =
    | "checkin_time"
    | "checkout_time"
    | "capacity"
    | "deposit"
    | "price"
    | "url"
    | "access_code"
    | "wifi"
    | "house_rule"
    | "thread_team"
    | "other";

export interface HardFact {
    kind: HardFactKind;
    /** Normalized token(s) for matching, lowercase. */
    norm: string;
    display: string;
    source: string;
}

export interface ExtractedClaim {
    type: HardFactKind | "amenity_assert" | "time" | "money" | "url" | "capacity" | "deposit";
    raw: string;
    norm: string;
}

export class FactLedger {
    hard: HardFact[] = [];
    softNotes: string[] = [];
    conflicts: string[] = [];

    addHard(kind: HardFactKind, display: string, source: string, extraNorms: string[] = []) {
        const displayClean = String(display || "").replace(/\s+/g, " ").trim();
        if (!displayClean) return;
        const norms = new Set<string>();
        norms.add(normText(displayClean));
        for (const e of extraNorms) {
            const n = normText(e);
            if (n) norms.add(n);
        }
        for (const m of displayClean.match(/[$€£]?\s?\d[\d,]*(?:\.\d+)?/g) || []) {
            norms.add(normText(m.replace(/[^\d.]/g, "")));
        }
        for (const m of displayClean.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi) || []) {
            norms.add(normTime(m));
        }
        for (const m of displayClean.match(/https?:\/\/\S+/gi) || []) {
            norms.add(normText(m.replace(/[),\].]+$/, "")));
        }
        for (const n of norms) {
            if (!n) continue;
            this.hard.push({ kind, norm: n, display: displayClean, source });
        }
    }

    renderHardSection(): string {
        if (!this.hard.length && !this.conflicts.length) {
            return [
                "## HARD FACTS (only these may be stated as certain)",
                "- (none extracted — do NOT invent times, prices, capacity, deposits, amenity locations, or links; defer to the team)",
            ].join("\n");
        }
        const seen = new Set<string>();
        const lines: string[] = ["## HARD FACTS (only these may be stated as certain)"];
        for (const f of this.hard) {
            const key = `${f.kind}|${f.display}`;
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push(`- [${f.kind} / ${f.source}] ${f.display}`);
        }
        if (this.conflicts.length) {
            lines.push("");
            lines.push("## CONFLICTS (SOFT contradicted HARD — escalate; do not assert the soft side)");
            for (const c of this.conflicts) lines.push(`- ${c}`);
        }
        return lines.join("\n");
    }

    supports(claim: ExtractedClaim): boolean {
        const n = claim.norm;
        if (!n) return false;
        for (const f of this.hard) {
            if (!f.norm) continue;
            if (f.norm === n || f.norm.includes(n) || n.includes(f.norm)) return true;
            if (
                (claim.type === "time" || f.kind === "checkout_time" || f.kind === "checkin_time") &&
                timesLooselyEqual(n, f.norm)
            ) {
                return true;
            }
        }
        return false;
    }
}

export function normText(s: string): string {
    return String(s || "")
        .toLowerCase()
        .replace(/[$,€£]/g, "")
        .replace(/[^a-z0-9.:/\-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

export function normTime(s: string): string {
    const m = String(s || "")
        .toLowerCase()
        .replace(/\./g, "")
        .match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/);
    if (!m) return normText(s);
    let h = Number(m[1]);
    const min = m[2] || "00";
    const ap = m[3];
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${h}:${min}`;
}

function timesLooselyEqual(a: string, b: string): boolean {
    const ta = normTime(a);
    const tb = normTime(b);
    if (ta && tb && ta === tb) return true;
    const ha = ta.split(":")[0];
    const hb = tb.split(":")[0];
    return Boolean(ha && ha === hb && (ta.includes(":") || tb.includes(":")));
}

export function extractFactualClaims(reply: string): ExtractedClaim[] {
    const text = String(reply || "");
    const out: ExtractedClaim[] = [];
    const push = (type: ExtractedClaim["type"], raw: string, norm: string) => {
        if (!raw || !norm) return;
        out.push({ type, raw: raw.trim(), norm });
    };

    for (const m of text.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)\b|\b\d{1,2}\s*(?:am|pm)\b/gi) || []) {
        push("time", m, normTime(m));
    }
    for (const m of text.match(/[$€£]\s?\d[\d,]*(?:\.\d+)?/g) || []) {
        push("money", m, normText(m.replace(/[^\d.]/g, "")));
    }
    for (const m of text.match(/https?:\/\/[^\s)]+/gi) || []) {
        push("url", m, normText(m.replace(/[),\].]+$/, "")));
    }
    for (const m of text.match(
        /\b(?:sleeps?|fit|accommodate|party of|group of|max(?:imum)?(?:\s+occupancy)?|up to)\s+(\d{1,2})\b/gi
    ) || []) {
        const num = m.match(/\d{1,2}/)?.[0];
        if (num) push("capacity", m, num);
    }
    if (/\b(no\s+(security\s+)?deposit|wasn'?t\s+a\s+(separate\s+)?(security\s+)?deposit|no deposit was collected)\b/i.test(text)) {
        push("deposit", "no deposit claim", "no deposit");
    }
    if (/\bsecurity\s+deposit\b/i.test(text) && /\b(refund|return|collected|hold|release)\b/i.test(text)) {
        push("deposit", "deposit discussion", "deposit");
    }
    const amenityPhrases = [
        "first aid kit",
        "first-aid kit",
        "we don't keep candles",
        "do not keep candles",
        "no candles",
    ];
    const lower = text.toLowerCase();
    for (const phrase of amenityPhrases) {
        if (lower.includes(phrase.replace(/-/g, " ")) || lower.includes(phrase)) {
            push("amenity_assert", phrase, normText(phrase));
        }
    }

    const seen = new Set<string>();
    return out.filter((c) => {
        const k = `${c.type}|${c.norm}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

export function ungroundedClaims(reply: string, ledger: FactLedger): ExtractedClaim[] {
    const claims = extractFactualClaims(reply);
    return claims.filter((c) => {
        if (c.type === "amenity_assert") return !ledger.supports(c);
        if (c.type === "deposit" && c.norm === "no deposit") {
            return !ledger.hard.some(
                (f) =>
                    f.kind === "deposit" &&
                    (/\b0\b/.test(f.display) || /no deposit|none|not required/i.test(f.display))
            );
        }
        if (c.type === "deposit") {
            return !ledger.hard.some((f) => f.kind === "deposit");
        }
        return !ledger.supports(c);
    });
}

const HARD_SECTION_RE =
    /^(conversation context|reservation details|reservation billing|door access|listing details|listing times|cancellation policy|live availability|available paid services|rental agreement|stay stage)/i;

const SOFT_SECTION_RE =
    /^(listing knowledge base|learned answers|how our team answered|proven replies|team feedback|listing documents|soft background)/i;

/**
 * Rebuild a flat buildContext string into HARD / SOFT / history sections and
 * populate a ledger from HARD bullets (best-effort structured extraction).
 */
export function restructureContextForHardFacts(flatContext: string): {
    prompt: string;
    ledger: FactLedger;
    verifierContext: string;
} {
    const ledger = new FactLedger();
    const parts = String(flatContext || "").split(/\n(?=## )/);
    const hardChunks: string[] = [];
    const softChunks: string[] = [];
    const historyChunks: string[] = [];
    const otherChunks: string[] = [];

    for (const part of parts) {
        const header = (part.match(/^##\s+([^\n(]+)/) || [])[1]?.trim() || "";
        const h = header.toLowerCase();
        if (/message history|latest guest message|task\b|staff instructions|current draft/i.test(h)) {
            historyChunks.push(part.trim());
            continue;
        }
        if (SOFT_SECTION_RE.test(h) || /amenities|portfolio-wide/i.test(part.slice(0, 200))) {
            const hardFromKb = extractHardFromKnowledge(part, ledger);
            if (hardFromKb) hardChunks.push(hardFromKb);
            softChunks.push(relabelSoft(part));
            continue;
        }
        if (HARD_SECTION_RE.test(h) || !header) {
            hardChunks.push(part.trim());
            ingestHardChunk(part, ledger);
            continue;
        }
        if (/internal operations|live bookings|service package|same-city|listing search/i.test(h)) {
            softChunks.push(relabelSoft(part));
            continue;
        }
        otherChunks.push(part.trim());
        ingestHardChunk(part, ledger);
    }

    const hardBody = [
        ledger.renderHardSection(),
        "",
        "### Supporting HARD context (source text)",
        ...hardChunks,
        ...otherChunks,
    ].join("\n\n");

    const softBody = softChunks.length
        ? [
              "## SOFT BACKGROUND (hedge only — 'listed as' / 'team will confirm'; NEVER override HARD; NEVER invent storage locations)",
              ...softChunks,
          ].join("\n\n")
        : "## SOFT BACKGROUND\n- (none)";

    const historyBody = historyChunks.join("\n\n");
    const rules = [
        "## HARD-FACT MODE RULES",
        "- Assert ONLY facts present under HARD FACTS / Supporting HARD context.",
        "- If the guest needs a fact that is not HARD, defer warmly, set escalation_required=true, and add a learning_question.",
        "- SOFT BACKGROUND is for tone and weak hints only — never state it as certain.",
        "- Prefer TEAM messages in Message history over everything else when they conflict.",
    ].join("\n");

    const prompt = [rules, "", hardBody, "", softBody, "", historyBody].join("\n").trim();
    const verifierContext = [ledger.renderHardSection(), "", historyBody].join("\n").trim();
    return { prompt, ledger, verifierContext };
}

function relabelSoft(part: string): string {
    return part.replace(/^##\s+/, "## SOFT: ");
}

function extractHardFromKnowledge(part: string, ledger: FactLedger): string | null {
    const lines = part.split("\n");
    const keep: string[] = [];
    for (const line of lines) {
        const l = line.trim();
        if (/house\s*rules|no parties|no events|sleeps up to|max(?:imum)?\s+guests?|occupancy/i.test(l)) {
            keep.push(l);
            const sleeps = l.match(/sleeps up to\s+(\d+)/i);
            if (sleeps) ledger.addHard("capacity", `Sleeps up to ${sleeps[1]}`, "kb_overview", [sleeps[1]]);
            if (/no parties|no events/i.test(l)) {
                ledger.addHard("house_rule", l.replace(/^[-*]\s*/, "").slice(0, 240), "kb_house_rules");
            }
            const maxG = l.match(/max(?:imum)?(?:\s+occupancy)?(?:\s+of)?\s+(\d+)\s+guests?/i);
            if (maxG) ledger.addHard("capacity", `Max guests ${maxG[1]}`, "kb_house_rules", [maxG[1]]);
        }
    }
    return keep.length ? ["### HARD extracts from knowledge", ...keep].join("\n") : null;
}

function ingestHardChunk(part: string, ledger: FactLedger) {
    const text = part;
    const times = text.match(/check-?in from\s+([^,\n]+)|check-?out by\s+([^,\n]+)/gi) || [];
    for (const t of times) {
        if (/check-?in/i.test(t)) {
            const v = t.replace(/.*from\s+/i, "").trim();
            ledger.addHard("checkin_time", `Check-in from ${v}`, "listing_times", [v]);
        }
        if (/check-?out/i.test(t)) {
            const v = t.replace(/.*by\s+/i, "").trim();
            ledger.addHard("checkout_time", `Check-out by ${v}`, "listing_times", [v]);
        }
    }
    const co = text.match(/check-out date:[^\n]*\(by\s+([^)]+)\)/i);
    if (co) ledger.addHard("checkout_time", `Check-out by ${co[1]}`, "reservation", [co[1]]);
    const ci = text.match(/check-in date:[^\n]*\(from\s+([^)]+)\)/i);
    if (ci) ledger.addHard("checkin_time", `Check-in from ${ci[1]}`, "reservation", [ci[1]]);

    const cap = text.match(/Max guests:\s*(\d+)/i) || text.match(/Sleeps up to\s+(\d+)/i);
    if (cap) ledger.addHard("capacity", `Max guests ${cap[1]}`, "listing_details", [cap[1]]);

    const dep = text.match(/Security deposit[^\n]*/i);
    if (dep) ledger.addHard("deposit", dep[0].slice(0, 240), "reservation_billing");

    for (const m of text.match(/~\w+\s+(\d+(?:\.\d+)?)(?:–(\d+(?:\.\d+)?))?\/night/g) || []) {
        ledger.addHard("price", m, "calendar");
    }
    for (const m of text.match(/\$(\d+(?:\.\d{2})?)/g) || []) {
        const idx = text.indexOf(m);
        if (/upsell|paid services|extension|fee/i.test(text.slice(Math.max(0, idx - 80), idx + 40))) {
            ledger.addHard("price", m, "upsell_or_fee");
        }
    }
    for (const m of text.match(/https?:\/\/[^\s)]+/gi) || []) {
        const url = m.replace(/[),\].]+$/, "");
        if (/chargeautomation\.com\/securelink/i.test(url)) ledger.addHard("url", url, "chargeautomation");
        else if (/rental-agreement\//i.test(url)) ledger.addHard("url", url, "securestay_agreement");
        else if (/hostify\.com\/checkin/i.test(url)) {
            ledger.addHard("url", `${url} (pre-checkin ONLY)`, "hostify_precheckin");
        }
    }
    const code = text.match(/Code:\s*([^\s(]+)/i);
    if (code) ledger.addHard("access_code", `Code ${code[1]}`, "access_codes", [code[1]]);
    const wifi = text.match(/WiFi network:\s*([^\n—]+)/i);
    if (wifi) ledger.addHard("wifi", wifi[0].slice(0, 200), "listing_wifi");
}

export function hardFactSystemAddendum(): string {
    return [
        "",
        "HARD-FACT MODE (active for this draft):",
        "- A HARD FACTS section is the only source of assertable property/reservation facts.",
        "- SOFT BACKGROUND must not be stated as certain; hedge or defer.",
        "- Never invent amenity locations. Never send Hostify check-in URLs as rental agreements.",
        "- Prefer deferral + escalation over a confident guess.",
    ].join("\n");
}
