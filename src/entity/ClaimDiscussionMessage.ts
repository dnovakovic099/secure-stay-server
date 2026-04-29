import { CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Column, UpdateDateColumn } from "typeorm";

export interface ClaimDiscussionAttachment {
    fileName: string;
    originalName: string;
    mimeType: string;
    size: number;
    url: string;
}

export type ClaimDiscussionSourceType = "note" | "system" | "slack";

@Entity({ name: "claim_discussion_messages" })
@Index("idx_claim_discussion_claim", ["claimId"])
@Index("idx_claim_discussion_parent", ["parentMessageId"])
export class ClaimDiscussionMessageEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "int", name: "claim_id" })
    claimId: number;

    @Column({ type: "int", nullable: true, name: "parent_message_id" })
    parentMessageId: number | null;

    @Column({ type: "varchar", length: 20, name: "source_type" })
    sourceType: ClaimDiscussionSourceType;

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
