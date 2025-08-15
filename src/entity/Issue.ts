import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany } from "typeorm";
import { IssueUpdates } from "./IsssueUpdates";

@Entity('issues')
export class Issue {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: ["New", "In Progress", "Overdue", "Completed", "Need Help", "Scheduled"],
        default: "In Progress"
    })
    status: string;

    @Column()
    listing_id: string;

    @Column({ nullable: true })
    listing_name: string;

    @Column({ nullable: true })
    reservation_id: string;

    @Column({ type: 'date', nullable: true })
    check_in_date: Date;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    reservation_amount: number;

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

    @Column({ type: 'datetime', nullable: true })
    completed_at: Date;

    @Column({ nullable: true })
    claim_resolution_status: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    claim_resolution_amount: number;

    @Column({ type: 'text', nullable: true })
    next_steps: string;

    @CreateDateColumn()
    created_at: Date;

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

    @Column({ nullable: true })
    category: string;

    @OneToMany(() => IssueUpdates, issue => issue.issue)
    issueUpdates: IssueUpdates[];

    @Column({ type: "text", nullable: true })
    resolution: string;
}