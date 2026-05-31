import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany, Index } from "typeorm";
import { IssueUpdates } from "./IsssueUpdates";

@Entity('issues')
@Index('idx_issues_status_listing_created', ['status', 'listing_id', 'created_at'])
export class Issue {
    @PrimaryGeneratedColumn()
    id: number;

    @Index()
    @Column({
        type: "enum",
        enum: ["New", "In Progress", "Overdue", "Completed", "Need Help", "Scheduled"],
        default: "In Progress"
    })
    status: string;

    @Index()
    @Column({
        type: "enum",
        enum: ["New", "In Progress", "Overdue", "Completed", "Need Help", "Scheduled"],
        default: "New",
        nullable: true,
        name: "gr_status"
    })
    gr_status: string;

    @Index()
    @Column()
    listing_id: string;

    @Column({ nullable: true })
    listing_name: string;

    @Index()
    @Column({ nullable: true })
    reservation_id: string;

    @Column({ type: 'text', nullable: true })
    linked_reservations: string;

    @Column({ type: 'date', nullable: true })
    check_in_date: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    reservation_amount: number;

    @Index()
    @Column({ nullable: true })
    channel: string;

    @Column({ nullable: true })
    guest_name: string;

    @Column({ nullable: true })
    guest_contact_number: string;

    @Column({ type: 'text', nullable: true })
    issue_description: string;

    @Column({ type: 'text', nullable: true })
    owner_notes: string;

    @Column({ type: 'text', nullable: true })
    payment_information: string;

    @Column({ nullable: true })
    creator: string;

    @Column({ type: 'date', nullable: true })
    date_time_reported: Date;

    @Column({ type: 'date', nullable: true })
    date_time_contractor_contacted: Date;

    @Column({ type: 'date', nullable: true })
    date_time_contractor_deployed: Date;

    @Column({ type: 'text', nullable: true })
    quote_1: string;

    @Column({ type: 'text', nullable: true })
    quote_2: string;

    @Column({ type: 'text', nullable: true })
    quote_3: string;

    @Column({ type: 'text', nullable: true })
    quote_4: string;

    @Column({ type: 'text', nullable: true })
    quote_5: string;

    @Column({ type: 'text', nullable: true })
    quote_6: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    estimated_reasonable_price: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    final_price: number;

    @Column({ type: 'datetime', nullable: true })
    date_time_work_finished: Date;

    @Column({ nullable: true })
    final_contractor_name: string;

    @Column({ nullable: true })
    issue_reporter: string;

    @Column({ type: 'text', nullable: true })
    is_preventable: string;

    @Column({ nullable: true })
    completed_by: string;

    @Index()
    @Column({ type: 'datetime', nullable: true })
    completed_at: Date;

    @Column({ nullable: true })
    claim_resolution_status: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    claim_resolution_amount: number;

    @Column({ type: 'text', nullable: true })
    next_steps: string;

    @Index()
    @CreateDateColumn()
    created_at: Date;

    @Index()
    @UpdateDateColumn()
    updated_at: Date;

    @DeleteDateColumn()
    deleted_at: Date;

    @Column({ nullable: true })
    created_by: string;

    @Column({ nullable: true })
    updated_by: string;

    @Column({ nullable: true })
    deleted_by: string;

    @Column({ type: 'text', nullable: true })
    fileNames: string;

    @Index()
    @Column({ nullable: true })
    category: string;

    @OneToMany(() => IssueUpdates, issue => issue.issue)
    issueUpdates: IssueUpdates[];

    @Column({ type: "text", nullable: true })
    resolution: string;

    @Column({ type: 'datetime', nullable: true })
    resolution_refreshed_at: Date;

    @Column({ nullable: true })
    resolution_refreshed_by: string;

    @Column({ type: "text", nullable: true })
    ai_short_title: string;

    @Column({ type: "text", nullable: true })
    ai_checklist: string;

    @Column({ type: "text", nullable: true })
    manager_feedback: string;

    @Column({ type: 'datetime', nullable: true })
    manager_feedback_updated_at: Date;

    @Column({ nullable: true })
    manager_feedback_updated_by: string;

    @Column({ type: "boolean", nullable: true })
    preventable_flag: boolean;

    @Column({ nullable: true })
    ai_resolution_status: string;

    @Column({ nullable: true })
    ai_guest_sentiment: string;

    @Index()
    @Column({ nullable: true })
    assignee: string;

    @Index()
    @Column({ nullable: true })
    urgency: number;

    @Column({ nullable: true })
    mistake: string;

    @Column({ nullable: true })
    mistakeResolvedOn: string;

    @Column({ nullable: true })
    nextUpdateDate: string;

    @Index()
    @Column({ nullable: true })
    due_date: string;
}
