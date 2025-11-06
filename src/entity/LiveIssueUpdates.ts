import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, DeleteDateColumn } from 'typeorm';
import { LiveIssue } from './LiveIssue';

@Entity('live_issue_updates')
export class LiveIssueUpdates {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: "text", nullable: true })
    updates: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;

    @ManyToOne(() => LiveIssue, liveIssue => liveIssue.liveIssueUpdates, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'liveIssueId' })
    liveIssue: LiveIssue;
}
