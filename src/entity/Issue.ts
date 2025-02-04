import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('issues')
export class Issue {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: ["In Progress", "Overdue", "Completed", "Need Help"],
        default: "In Progress"
    })
    status: string;

    @Column()
    listing_id: string;

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

    @Column({
        type: 'enum',
        enum: ['Yes', 'No'],
        nullable: true
    })
    needs_attention: string;

    @Column({
        type: 'enum',
        enum: ['N/A', 'Pending', 'Completed', 'Denied'],
        default: 'N/A'
    })
    claim_resolution_status: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    claim_resolution_amount: number;

    @Column({ type: 'text', nullable: true })
    next_steps: string;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;
}