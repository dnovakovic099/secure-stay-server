import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from "typeorm";

export type ReviewDiscussionReactionType = "eyes" | "heart" | "check" | "warning";

@Entity({ name: "review_discussion_reactions" })
@Index("idx_review_discussion_reaction_message", ["messageId"])
@Index("uniq_review_discussion_reaction_user", ["messageId", "userId", "reaction"], { unique: true })
export class ReviewDiscussionReactionEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "int", name: "message_id" })
    messageId: number;

    @Column({ type: "varchar", length: 100, name: "user_id" })
    userId: string;

    @Column({ type: "varchar", length: 255, name: "user_name" })
    userName: string;

    @Column({ type: "varchar", length: 20, name: "reaction" })
    reaction: ReviewDiscussionReactionType;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;
}
