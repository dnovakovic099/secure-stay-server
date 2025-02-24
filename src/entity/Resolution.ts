import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("resolutions")
export class Resolution {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({
        type: "enum",
        enum: ["claim", "security_deposit", "pet_fee", "extra_cleaning", "others"]
    })
    category: string;

    @Column({ nullable: true })
    otherCategoryDescription: string;

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