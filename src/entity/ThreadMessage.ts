import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type ThreadMessageSource = 'slack' | 'securestay';

@Entity({ name: 'thread_message' })
export class ThreadMessageEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'int', name: 'gr_task_id' })
    grTaskId: number;

    @Column({ type: 'varchar', length: 20, name: 'source' })
    source: ThreadMessageSource;

    @Column({ type: 'varchar', length: 255, name: 'user_name' })
    userName: string;

    @Column({ type: 'varchar', length: 500, nullable: true, name: 'user_avatar' })
    userAvatar: string | null;

    @Column({ type: 'text', name: 'content' })
    content: string;

    @Column({ type: 'varchar', length: 50, nullable: true, name: 'slack_message_ts' })
    slackMessageTs: string | null;

    @Column({ type: 'datetime', name: 'message_timestamp' })
    messageTimestamp: Date;

    @CreateDateColumn({ name: 'created_at' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at' })
    updatedAt: Date;
}
