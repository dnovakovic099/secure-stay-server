import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn } from "typeorm";

@Entity("resolutions")
export class Resolution {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: false })
    category: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column()
    listingMapId: number;

    @Column()
    guestName: string;

    @Column()
    reservationId: number;

    @Column({ type: "date" })
    claimDate: Date;

    @Column({ type: "decimal", precision: 10, scale: 2 })
    amount: number;

    @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
    amountToPayout: number;

    @Column({ nullable: true })
    arrivalDate: string;

    @Column({ nullable: true })
    departureDate: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @DeleteDateColumn({ nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;
} 