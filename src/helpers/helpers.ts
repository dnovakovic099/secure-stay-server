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
        case "POOL AND SPA": {
            emoji = "🏊"; 
            break;
        }
        case "PEST CONTROL": {
            emoji = "🐜"; 
            break;
        }
        case "LANDSCAPING": {
            emoji = "🌳"; 
            break;
        }
        case "HVAC": {
            emoji = "❄️"; 
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

export const claimStatusEmoji = (status: string) => {
    let emoji = "";
    switch (status) {
        case "Not Submitted": {
            emoji = "⚪️"; // white circle for not started
            break;
        }
        case "In Progress": {
            emoji = "🟡"; // yellow circle for in progress
            break;
        }
        case "Submitted": {
            emoji = "🔵"; // blue circle for submitted
            break;
        }
        case "Resolved": {
            emoji = "🟢"; // green circle for resolved
            break;
        }
        case "Denied": {
            emoji = "🔴"; // red circle for denied
            break;
        }
        default: {
            emoji = "❔"; // question mark for unknown status
        }
    }
    return emoji;
};


const slackUsers = {
    // PRASANNA_KUMAR_BANIYA: "U07K1N81HMW",
    // PRABIN_KUMAR_BANIYA: "U07JFDC86H2",
    // TRIBIKRAM_SEN: "U07HYC3TBF1",
    FERDY: "U07P974D65P",
    LOUIS: "U06QKAV9VV5",
    DARKO: "U06TCAW5YLE",
    GABBY: "U088XAQ4YP2",
    JADE: "U08EUTR1H9A",
    KAJ: "U073DCTHNKY",
    ANGELICA: "U08END0JTBM",
    JAZZ: "U093172T6MP",
    JOREL: "U09278TM6A3",
    JUSTINE: "U09626Z6JUQ",
    ALDRIN: "U0974TJ85Q9",
    RAIN: "U096SNZR9CL",
    CHRIS: "U0948PQC9UZ",
    JULIUS: "U08QJBLNG6A",
    IAN: "U0962L2EG4S",
    CARYL: "U0977E4NNLX",
    YSA: "U097P8RNXS6",
    ABHEY: "U08CL60E6U8"
};

let selectedSlackUsers = [];

export function getSelectedSlackUsers() {
    return selectedSlackUsers;
}

export function setSelectedSlackUsers(newValue: string[]) {
    selectedSlackUsers = newValue;
}

export const clientTicketMentions = (category: string) => {
    let mentions = [];
    switch (category) {
        case "Pricing": {
            mentions = [slackUsers.GABBY, slackUsers.FERDY];
            break;
        }
        case "Statement": {
            mentions = [slackUsers.GABBY, slackUsers.FERDY, slackUsers.ABHEY];
            break;
        }
        case "Reservation": {
            mentions = [slackUsers.GABBY];
            break;
        }
        case "Listing": {
            mentions = [slackUsers.GABBY];
            break;
        }
        case "Maintenance": {
            mentions = [slackUsers.GABBY];
            break;
        }
        case "Other": {
            mentions = selectedSlackUsers;
            break;
        }
        case "Onboarding": {
            mentions = [slackUsers.GABBY];
            break;
        }
        default: {
            mentions = [];
        }
    }
    return mentions;
}

export const getStarRating = (ratingOutOf10: number): string => {
    const ratingOutOf5 = Math.round((ratingOutOf10 / 2) * 2) / 2; // Round to 0.5
    const fullStars = Math.floor(ratingOutOf5);
    const halfStar = ratingOutOf5 % 1 !== 0;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

    return '⭐'.repeat(fullStars) + (halfStar ? '🌟' : '') + '☆'.repeat(emptyStars);
};

export function generateSlackMessageLink(workspaceDomain: string, channelId: string, messageTs: string) {
    const tsClean = messageTs.replace('.', '');
    return `${workspaceDomain}/archives/${channelId}/p${tsClean}`;
}

export function isEmail(value: string) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
}



// | Status | Emoji |
// | ----------- | ----- |
// | New | 🔵    |
// | In Progress | 🟡    |
// | Incomplete | 🟠    |
// | Need Help | 🟣    |
// | Overdue | 🟤    |
// | Expired | 🔴    |
// | Completed | 🟢    |

