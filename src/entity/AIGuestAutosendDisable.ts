import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    Index,
} from "typeorm";

/**
 * Mute Hostify inbox auto-respond for a specific guest (Hostify guestId).
 * Set from the Inbox V2 "Disable auto-respond" control for problematic guests.
 */
@Entity("ai_guest_autosend_disable")
export class AIGuestAutosendDisableEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Index({ unique: true })
    @Column({ type: "bigint" })
    guestId: number;

    @Column({ length: 255, nullable: true })
    guestName: string | null;

    @Column({ length: 255, nullable: true })
    disabledBy: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
