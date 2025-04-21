import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

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

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
} 