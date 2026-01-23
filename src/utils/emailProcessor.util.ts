import { convert } from 'html-to-text';

export class EmailProcessor {
    /**
     * Process email bodies to get clean, normalized content
     */
    static process(html: string | null, plain: string | null): string {
        let content = '';

        // 1. Choose source: HTML is usually more reliable if converted properly, 
        // fallback to plain if HTML is missing.
        if (html) {
            content = this.convertHtmlToText(html);
        } else if (plain) {
            content = plain;
        }

        if (!content) return '';

        // 2. Strip noise (quoted replies, signatures, etc.)
        content = this.stripQuotedReplies(content);
        content = this.stripSignatures(content);

        return content.trim();
    }

    /**
     * Convert HTML to clean text
     */
    private static convertHtmlToText(html: string): string {
        try {
            return convert(html, {
                wordwrap: false,
                selectors: [
                    { selector: 'a', options: { ignoreHref: true } },
                    { selector: 'img', format: 'skip' },
                    { selector: 'nav', format: 'skip' },
                    { selector: 'footer', format: 'skip' },
                    { selector: 'script', format: 'skip' },
                    { selector: 'style', format: 'skip' }
                ]
            });
        } catch (error) {
            console.error('Error converting HTML to text:', error);
            return html.replace(/<[^>]*>?/gm, ''); // Simple fallback regex
        }
    }

    /**
     * Strip quoted replies (On ... wrote, From: ..., etc.)
     */
    private static stripQuotedReplies(text: string): string {
        const patterns = [
            /^-+Original Message-+/im,
            /^On\s.+\swrote:$/im,
            /^From:\s.+/im,
            /^Sent:\s.+/im,
            /^To:\s.+/im,
            /^Subject:\s.+/im,
            /^________________________________/m,
            /^>+/m, // Quoted lines starting with >
        ];

        let processedText = text;
        for (const pattern of patterns) {
            const index = processedText.search(pattern);
            if (index !== -1) {
                processedText = processedText.substring(0, index);
            }
        }

        return processedText;
    }

    /**
     * Strip common signature patterns
     */
    private static stripSignatures(text: string): string {
        const signaturePatterns = [
            /^--\s*$/m, // Standard email signature separator
            /^Cheers,?\s*$/im,
            /^Regards,?\s*$/im,
            /^Best regards,?\s*$/im,
            /^Thanks,?\s*$/im,
            /^Sincerely,?\s*$/im,
        ];

        let processedText = text;
        for (const pattern of signaturePatterns) {
            const index = processedText.search(pattern);
            if (index !== -1) {
                processedText = processedText.substring(0, index);
            }
        }

        return processedText;
    }
}
