import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("ll_buddy_feedback")
export class LLBuddyFeedbackEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Index()
    @Column({ length: 36, nullable: true })
    suggestionId: string | null;

    @Column({ length: 40 })
    rating: "accepted" | "edited" | "rejected" | "thumbs_up" | "thumbs_down";

    @Column("text", { nullable: true })
    finalReply: string | null;

    @Column("text", { nullable: true })
    notes: string | null;

    @Column("json", { nullable: true })
    tags: string[] | null;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
