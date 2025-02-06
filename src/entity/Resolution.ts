import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("resolutions")
export class Resolution {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: ["full_claim", "partial_claim", "security_deposit"]
    })
    category: string;

    @Column()
    listingMapId: number;

    @Column()
    guestName: string;

    @Column({ type: "date" })
    claimDate: Date;

    @Column({ type: "decimal", precision: 10, scale: 2 })
    amount: number;

    @Column()
    userId: string;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
} 