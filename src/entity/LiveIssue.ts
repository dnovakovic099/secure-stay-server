import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany } from 'typeorm';
import { LiveIssueUpdates } from './LiveIssueUpdates';

export enum LiveIssueStatus {
    NEW = 'New',
    IN_PROGRESS = 'In Progress',
    CLOSED_RESOLVED = 'Closed - Resolved',
    CLOSED_FAILED = 'Closed - Failed',
    CLOSED_NEGOTIATED = 'Closed - Negotiated',
    CLOSED_TRAPPED = 'Closed - Trapped'
}

@Entity('live_issues')
export class LiveIssue {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: LiveIssueStatus,
        default: LiveIssueStatus.NEW
    })
    status: string;

    @Column({ nullable: true })
    assignee: string;

    @Column({ nullable: true })
    assigneeId: string;

    @Column({ nullable: true })
    propertyId: number; // listingMapId

    @Column({ type: 'text', nullable: true })
    summary: string;

    @Column({ type: 'text', nullable: true })
    comments: string;

    @Column({ type: 'datetime', nullable: true })
    followUp: Date;

    @OneToMany(() => LiveIssueUpdates, liveIssueUpdates => liveIssueUpdates.liveIssue, { onDelete: 'CASCADE' })
    liveIssueUpdates: LiveIssueUpdates[];

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
}

