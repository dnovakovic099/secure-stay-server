import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'slack_messages' })
export class SlackMessageEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 50 })
    channel: string; // Slack channel ID or name

    @Column({ type: 'varchar', length: 50 })
    messageTs: string; // The ts of the original message (used to update/delete)

    @Column({ type: 'varchar', length: 50 })
    threadTs: string; // Same as messageTs for root messages, different for replies

    @Column({ type: 'varchar', length: 255, nullable: true })
    entityType: string; 

    @Column({ nullable: true })
    entityId: number; 

    @Column({ type: 'text', nullable: true })
    originalMessage: string; // JSON.stringified payload (optional)

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
