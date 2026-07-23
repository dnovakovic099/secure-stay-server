import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * AutoMessageRule
 *
 * A staff-defined rule that automatically sends a guest message when its
 * trigger + conditions match (inquiry winback, trash-day reminders, pre-arrival
 * notes, one-off scheduled follow-ups, ...). Evaluated by
 * AutoMessageService.processDueMessages() on a schedule; every delivery is
 * recorded in auto_message_log with a dedupe key so a rule can never
 * double-send to the same thread for the same occurrence.
 *
 * Rules are created DISABLED and must be explicitly enabled by staff.
 */
@Entity("auto_message_rules")
export class AutoMessageRuleEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 255 })
    name: string;

    @Index()
    @Column({ type: "tinyint", default: 0 })
    enabled: number;

    /**
     * 'inquiry_winback'  — guest inquired, no booking after offsetHours of silence
     * 'before_checkin'   — offsetDays before check-in at sendTime
     * 'after_checkin'    — offsetDays after check-in at sendTime
     * 'before_checkout'  — offsetDays before check-out at sendTime
     * 'after_checkout'   — offsetDays after check-out at sendTime
     * 'day_of_week'      — during the stay, on daysOfWeek at sendTime (e.g. trash night)
     * 'one_time'         — a single message to one thread at sendAt (follow-up reminder)
     */
    @Index()
    @Column({ length: 30 })
    triggerType: string;

    /** Hours of guest silence before an inquiry winback fires. */
    @Column({ type: "int", nullable: true })
    offsetHours: number | null;

    /** Day offset for before/after check-in/check-out triggers (0 = same day). */
    @Column({ type: "int", nullable: true })
    offsetDays: number | null;

    /** CSV of 0-6 (Sun-Sat) for day_of_week triggers, e.g. "1,4". */
    @Column({ length: 30, nullable: true })
    daysOfWeek: string | null;

    /** "HH:MM" 24h, America/New_York — earliest send time for date-based triggers. */
    @Column({ length: 5, nullable: true })
    sendTime: string | null;

    /** Absolute send time for one_time rules. */
    @Column({ type: "datetime", nullable: true })
    sendAt: Date | null;

    /** Target thread for one_time rules. */
    @Index()
    @Column({ type: "bigint", nullable: true })
    threadId: number | null;

    /** CSV of listing ids this rule applies to; NULL/empty = all properties. */
    @Column({ type: "text", nullable: true })
    listingIds: string | null;

    /** CSV of channels (e.g. "airbnb,vrbo"); NULL/empty = all channels. */
    @Column({ length: 255, nullable: true })
    channels: string | null;

    /** CSV of reservation statuses to match; NULL = trigger-appropriate default. */
    @Column({ length: 255, nullable: true })
    reservationStatuses: string | null;

    /** Stay-length filters (nights). */
    @Column({ type: "int", nullable: true })
    minNights: number | null;

    @Column({ type: "int", nullable: true })
    maxNights: number | null;

    /**
     * Skip sending when the guest has messaged after our last reply (there's a
     * pending question a human/AI should answer instead of a canned blast).
     */
    @Column({ type: "tinyint", default: 1 })
    skipIfGuestReplied: number;

    /**
     * Message text. Placeholders: {{guest_name}}, {{first_name}},
     * {{listing_name}}, {{checkin}}, {{checkout}}, {{nights}}.
     */
    @Column({ type: "text" })
    messageTemplate: string;

    /**
     * Optional staff instructions for send-time AI rewrite. When set, the engine
     * rewrites messageTemplate using the live thread context at send time.
     */
    @Column({ type: "text", nullable: true })
    aiDirective: string | null;

    /**
     * When 1, send-time AI may abort delivery if the draft is no longer
     * contextually appropriate (guest already answered, booking cancelled, etc.).
     */
    @Column({ type: "tinyint", default: 0 })
    aiSkipIfInappropriate: number;

    @Column({ type: "int", nullable: true })
    createdByUserId: number | null;

    @Column({ length: 255, nullable: true })
    createdByName: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
