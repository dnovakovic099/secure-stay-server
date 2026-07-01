import OpenAI from "openai";
import logger from "../utils/logger.utils";

export const EMBEDDING_MODEL = process.env.AI_EMBEDDING_MODEL || "text-embedding-3-small";

/**
 * Thin wrapper around the OpenAI embeddings API plus vector math. Kept separate
 * from InboxAIService so any part of the system can embed/compare text.
 */
export class EmbeddingService {
    private getClient(): OpenAI {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
        return new OpenAI({ apiKey });
    }

    /** Embed one string. */
    async embedOne(text: string): Promise<number[]> {
        const [v] = await this.embedMany([text]);
        return v;
    }

    /** Embed many strings, batched to stay within request limits. */
    async embedMany(texts: string[], batchSize = 96): Promise<number[][]> {
        const client = this.getClient();
        const out: number[][] = [];
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize).map((t) => (t && t.trim() ? t.slice(0, 6000) : "(empty)"));
            const resp = await client.embeddings.create({ model: EMBEDDING_MODEL, input: batch });
            for (const d of resp.data) out.push(d.embedding as number[]);
        }
        return out;
    }

    static cosine(a: number[], b: number[]): number {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na += a[i] * a[i];
            nb += b[i] * b[i];
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb);
        return denom === 0 ? 0 : dot / denom;
    }

    static parseVector(json: string | null): number[] | null {
        if (!json) return null;
        try {
            const v = JSON.parse(json);
            return Array.isArray(v) ? v : null;
        } catch {
            return null;
        }
    }
}
