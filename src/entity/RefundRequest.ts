import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('refund_request_info')
export class RefundRequestEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: "bigint" })
    reservationId: number;

    @Column()
    listingId: number;

    @Column()
    guestName: string;

    @Column({ nullable: true })
    listingName: string;

    @Column()
    checkIn: string;

    @Column()
    checkOut: string;

    @Column({ nullable: true })
    issueId: number;

    @Column({ nullable: true })
    expenseId: number;

    @Column({ type: "text", nullable: false })
    explaination: string;

    @Column({ type: "float", nullable: false })
    refundAmount: number;

    @Column({ nullable: true })
    requestedBy: string;

    @Column({ nullable: false })
    status: string;

    @Column({ type: "text", nullable: true })
    notes: string;

    @Column({ nullable: true, type: 'text' })
    attachments: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}