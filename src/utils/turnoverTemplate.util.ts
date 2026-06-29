import { Listing } from "../entity/Listing";
import { ReservationInfoEntity } from "../entity/ReservationInfo";
import { UpsellOrder } from "../entity/UpsellOrder";

export type TurnoverTemplateContext = {
    reservation: ReservationInfoEntity;
    listing: Listing;
    upsells?: UpsellOrder[];
    turnoverNotes?: string;
    ownerName?: string | null;
    ownerEmail?: string | null;
    ownerPhone?: string | null;
    preStayReservation?: ReservationInfoEntity | null;
    postStayReservation?: ReservationInfoEntity | null;
};

export type RenderedTurnoverTemplate = {
    message: string;
    missingVariables: string[];
    unknownVariables: string[];
    blocked: boolean;
};

const VARIABLE_PATTERN = /\{([a-zA-Z0-9_]+)\}/g;

const formatDate = (value?: Date | string | null) => {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

const formatTime = (value?: string | number | null) => {
    if (value === undefined || value === null || value === "") return "";
    if (typeof value === "number") return `${String(value).padStart(2, "0")}:00`;
    return String(value);
};

const formatUpsells = (upsells?: UpsellOrder[]) => {
    if (!upsells || upsells.length === 0) return "No approved upsells for this reservation.";
    return ["Approved Upsells:", ...upsells.map((upsell) => `- ${upsell.type || "Upsell"}`)].join("\n");
};

export const renderTurnoverTemplate = (
    template: string,
    context: TurnoverTemplateContext
): RenderedTurnoverTemplate => {
    const reservation = context.reservation;
    const listing = context.listing;
    const preStayReservation = context.preStayReservation || reservation;
    const postStayReservation = context.postStayReservation || reservation;
    const values: Record<string, string> = {
        propertyName: listing.internalListingName || listing.name || "",
        listingName: listing.name || "",
        listingNickname: listing.internalListingName || listing.name || "",
        address: listing.address || "",
        reservationId: String(reservation.id || ""),
        reservationCode: reservation.reservationId || reservation.hostawayReservationId || "",
        guestName: reservation.guestName || "",
        checkInDate: formatDate(reservation.arrivalDate),
        checkOutDate: formatDate(reservation.departureDate),
        checkInTime: formatTime(reservation.checkInTime ?? (listing as any).checkInTimeStart),
        checkOutTime: formatTime(reservation.checkOutTime ?? (listing as any).checkOutTime),
        upsellInfo: formatUpsells(context.upsells),
        turnoverNotes: context.turnoverNotes || "",
        ownerName: context.ownerName || "",
        ownerEmail: context.ownerEmail || "",
        ownerPhone: context.ownerPhone || "",
        preStayReservationId: String(preStayReservation?.id || ""),
        postStayReservationId: String(postStayReservation?.id || ""),
        preStayGuestName: preStayReservation?.guestName || "",
        postStayGuestName: postStayReservation?.guestName || "",
    };

    const missing = new Set<string>();
    const unknown = new Set<string>();
    const used = new Set<string>();
    const rendered = template.replace(VARIABLE_PATTERN, (_match, variableName: string) => {
        used.add(variableName);
        if (!(variableName in values)) {
            unknown.add(variableName);
            return "";
        }
        const value = values[variableName];
        if (!value) missing.add(variableName);
        return value || "";
    });

    const allUsedVariablesFailed = used.size > 0 && Array.from(used).every((name) => unknown.has(name) || missing.has(name));

    return {
        message: rendered.replace(/[ \t]+\n/g, "\n").trim(),
        missingVariables: Array.from(missing),
        unknownVariables: Array.from(unknown),
        blocked: allUsedVariablesFailed || rendered.trim().length === 0,
    };
};

export const summarizeTemplateErrors = (rendered: RenderedTurnoverTemplate) => {
    const variables = [...rendered.unknownVariables, ...rendered.missingVariables];
    if (!variables.length) return "";
    return `Template variable issue: ${variables.map((name) => `{${name}}`).join(", ")}`;
};
