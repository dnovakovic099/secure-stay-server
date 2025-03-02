import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity("resolutions")
export class Resolution {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: false })
    category: string;

    @Column({ type: "text", nullable: true })
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