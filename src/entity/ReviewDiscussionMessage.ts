import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

export type ReviewDiscussionSourceType = "note" | "system" | "ai";

export interface ReviewDiscussionAttachment {
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
}

@Entity({ name: "review_discussion_messages" })
@Index("idx_review_discussion_review", ["reviewId"])
@Index("idx_review_discussion_reservation", ["reservationId"])
@Index("idx_review_discussion_parent", ["parentMessageId"])
export class ReviewDiscussionMessageEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 255, nullable: true, name: "review_id" })
    reviewId: string | null;

    @Column({ type: "bigint", nullable: true, name: "reservation_id" })
    reservationId: number | null;

    @Column({ type: "int", nullable: true, name: "parent_message_id" })
    parentMessageId: number | null;

    @Column({ type: "varchar", length: 20, name: "source_type" })
    sourceType: ReviewDiscussionSourceType;

    @Column({ type: "varchar", length: 100, nullable: true, name: "author_id" })
    authorId: string | null;

    @Column({ type: "varchar", length: 255, name: "author_name" })
    authorName: string;

    @Column({ type: "varchar", length: 500, nullable: true, name: "author_avatar" })
    authorAvatar: string | null;

    @Column({ type: "text", name: "content" })
    content: string;

    @Column({ type: "json", nullable: true, name: "mentions" })
    mentions: string[] | null;

    @Column({ type: "json", nullable: true, name: "metadata" })
    metadata: Record<string, any> | null;

    @CreateDateColumn({ name: "created_at" })
    createdAt: Date;

    @UpdateDateColumn({ name: "updated_at" })
    updatedAt: Date;
}
