import { v4 as uuidv4 } from 'uuid';

export function generateRandomNumber(length: number):number {
    if (length <= 0) {
        return null;
    }

    let randomNumber = '';
    for (let i = 0; i < length; i++) {
        randomNumber += Math.floor(Math.random() * 10);
    }

    return Number(randomNumber);
}

export function generateAPIKey(): string {
    return uuidv4();
}

export function removeNullValues(obj: Object) {
    return Object.fromEntries(
        Object.entries(obj).filter(([key, value]) => value !== null)
    );
}

export function isReactionMessage(message) {
    return /^.+ reacted .+ to your message /.test(message);
}

export function isEmojiOrThankYouMessage(message){
    if (!message) return false;

    let text = message.trim().toLowerCase();

    // Remove common punctuation
    text = text.replace(/[!.,?]/g, "");

    const positivePhrases = [
        "thank you",
        "thanks",
        "ok thanks",
        "thanks a lot",
        "ty",
        "thx",
        "ok thx",
        "thank u",
        "ok thank you"
    ];

    // Emoji regex
    const emojiPattern = /[\u231A-\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD-\u25FE\u2600-\u26FF\u2700-\u27BF\u2B50\u2B06\u2B07\u2B05\u2B06\u2B07\u2934\u2935\u3030\u303D\u3297\u3299\uD83C-\uDBFF\uDC00-\uDFFF]+/;

    // If it's only emojis
    if (text.replace(/\s/g, '').length && !text.replace(/\s/g, '').replace(emojiPattern, '')) {
        return true;
    }

    // If it starts with a positive phrase
    for (const phrase of positivePhrases) {
        if (text.startsWith(phrase)) {
            return true;
        }
    }

    // If it contains emoji + positive phrase somewhere
    if (emojiPattern.test(text)) {
        for (const phrase of positivePhrases) {
            if (text.includes(phrase)) {
                return true;
            }
        }
    }

    return false;
}

export const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount)
        .replace('$', '$ ');
};

export function getDiff(
    oldObj: Record<string, any>,
    newObj: Record<string, any>
): Record<string, { old: any; new: any; }> {
    const diff: Record<string, { old: any; new: any; }> = {};
    for (const key of Object.keys(newObj)) {
        const oldVal = oldObj[key];
        const newVal = newObj[key];

        const bothDates = oldVal instanceof Date && newVal instanceof Date;
        const dateChanged =
            bothDates && oldVal.getTime() !== newVal.getTime();

        const primitiveChanged =
            !bothDates && oldVal != newVal;

        if (dateChanged || primitiveChanged) {
            diff[key] = { old: oldVal, new: newVal };
        }
    }
    return diff;
}

export const capitalizeFirstLetter = (str: string) => {
    return str.charAt(0).toUpperCase() + str.slice(1);
};

export const issueCategoryEmoji = (category: string) => {
    let emoji = "";
    switch (category) {
        case "MAINTENANCE": {
            emoji = "🛠️";
            break;
        }
        case "CLEANLINESS": {
            emoji = "🧹";
            break;
        }
        default: {
            emoji = "";
        }
    }
    return emoji;
}

export const actionItemsStatusEmoji = (status: string) => {
    let emoji = "";
    switch (status) {
        case "expired": {
            emoji = "🔴";
            break;
        }
        case "incomplete": {
            emoji = "🟠";
            break;
        }
        case "completed": {
            emoji = "🟢";
            break;
        }
        case "in progress": {
            emoji = "🟡";
            break;
        }
        default: {
            emoji = "";
        }
    }
    return emoji;
};

export const issueStatusEmoji = (status: string) => {
    let emoji = "";
    switch (status) {
        case "Overdue": {
            emoji = "🟤";
            break;
        }
        case "Need Help": {
            emoji = "🟣";
            break;
        }
        case "Completed": {
            emoji = "🟢";
            break;
        }
        case "In Progress": {
            emoji = "🟡";
            break;
        }
        case "New": {
            emoji = "🔵";
            break;
        }
        case "Scheduled": {
            emoji = "⚪";
            break;
        }
        default: {
            emoji = "";
        }
    }
    return emoji;
};

export const clientTicketStatusEmoji = (status: string) => {
    let emoji = "";
    switch (status) {
        case "Completed": {
            emoji = "🟢";
            break;
        }
        case "In Progress": {
            emoji = "🟡";
            break;
        }
        case "New": {
            emoji = "🔵";
            break;
        }
        default: {
            emoji = "";
        }
    }
    return emoji;
};

// | Status | Emoji |
// | ----------- | ----- |
// | New | 🔵    |
// | In Progress | 🟡    |
// | Incomplete | 🟠    |
// | Need Help | 🟣    |
// | Overdue | 🟤    |
// | Expired | 🔴    |
// | Completed | 🟢    |

