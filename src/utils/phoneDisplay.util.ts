const stripExtension = (value: string) => value.replace(/\s*(?:ext\.?|x)\s*\d+$/i, "").trim();

const formatGroups = (countryCode: string, groups: string[]) =>
    `+${countryCode} ${groups.filter(Boolean).join(" ")}`.trim();

export const formatPhoneForDisplay = (value?: string | null): string => {
    const raw = String(value || "").trim();
    if (!raw) return "";

    const base = stripExtension(raw);
    const hasPlus = base.startsWith("+");
    const digits = base.replace(/\D/g, "");
    if (!digits) return raw;

    let countryCode = "";
    let national = "";

    if (hasPlus) {
        if (digits.startsWith("1") && digits.length === 11) {
            countryCode = "1";
            national = digits.slice(1);
        } else if (digits.startsWith("63") && digits.length >= 12) {
            countryCode = "63";
            national = digits.slice(2);
        } else if (digits.startsWith("61") && digits.length >= 11) {
            countryCode = "61";
            national = digits.slice(2);
        } else {
            const candidateCode = digits.length > 10 ? digits.slice(0, digits.length - 10) : "";
            countryCode = candidateCode || digits.slice(0, Math.max(1, digits.length - 9));
            national = digits.slice(countryCode.length);
        }
    } else if (digits.length === 10) {
        countryCode = "1";
        national = digits;
    } else if (digits.length === 11 && digits.startsWith("1")) {
        countryCode = "1";
        national = digits.slice(1);
    } else if (digits.length === 12 && digits.startsWith("63")) {
        countryCode = "63";
        national = digits.slice(2);
    } else if (digits.length === 11 && digits.startsWith("61")) {
        countryCode = "61";
        national = digits.slice(2);
    } else {
        return raw;
    }

    if (countryCode === "1" && national.length === 10) {
        return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
    }

    if (countryCode === "63") {
        const local = national.startsWith("0") ? national.slice(1) : national;
        if (local.length === 10) {
            return `+63 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
        }
    }

    if (countryCode === "61") {
        const local = national.startsWith("0") ? national.slice(1) : national;
        if (local.length === 9) {
            return `+61 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
        }
    }

    if (!countryCode || !national) return raw;

    if (national.length <= 3) return formatGroups(countryCode, [national]);
    if (national.length <= 7) return formatGroups(countryCode, [national.slice(0, 3), national.slice(3)]);
    return formatGroups(countryCode, [national.slice(0, 3), national.slice(3, 6), national.slice(6)]);
};

