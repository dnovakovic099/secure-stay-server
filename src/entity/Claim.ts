import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('claims')
export class Claim {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: ["Not Submitted", "In Progress", "Submitted", "Resolved"],
        default: "Not Submitted"
    })
    status: string;

    @Column()
    listing_id: string;

    @Column({ nullable: true })
    listing_name: string;

    @Column({ type: 'text', nullable: true })
    description: string;

    @Column({ type: 'text', nullable: true })
    reservation_link: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    client_requested_amount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnb_filing_amount: number;

    @Column({ type: 'text', nullable: true })
    airbnb_resolution: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnb_resolution_won_amount: number;

    @Column({ nullable: true })
    reservation_id: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    reservation_amount: number;

    @Column({ nullable: true })
    channel: string;

    @Column({ nullable: true })
    guest_name: string;

    @Column({ nullable: true })
    guest_contact_number: string;

    @Column({ type: 'text', nullable: true })
    quote_1: string;

    @Column({ type: 'text', nullable: true })
    quote_2: string;

    @Column({ type: 'text', nullable: true })
    quote_3: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    estimated_reasonable_price: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    final_price: number;

    @Column({ type: 'text', nullable: true })
    payment_information: string;

    @Column({ nullable: true })
    reporter: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    claim_resolution_amount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    client_paid_amount: number;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;

    @Column({ nullable: true })
    created_by: string;

    @Column({ nullable: true })
    updated_by: string;

    @Column({ type: 'text', nullable: true })
    fileNames: string;

    @Column({ type: 'text', nullable: true })
    payee: string;  
    
    @Column({ type: 'enum', enum: ["Not Paid", "Paid", "Partially Paid"], default: "Not Paid" })
    payment_status: string;
}