import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, DeleteDateColumn, Index } from 'typeorm';
import { Issue } from './Issue';

@Entity('issues_updates')
export class IssueUpdates {
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

    @Column({ type: 'varchar', length: 20, default: 'securestay' })
    source: 'securestay' | 'slack';

    @Index()
    @Column({ type: 'varchar', length: 50, nullable: true })
    slackMessageTs: string | null;

    @ManyToOne(() => Issue, issue => issue.issueUpdates, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'issueId' })
    issue: Issue;
}