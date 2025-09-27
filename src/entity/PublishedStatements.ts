import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
} from "typeorm";

@Entity("published_statements")
export class PublishedStatementEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    fromDate: string;

    @Column({nullable: true})
    toDate: string;

    @Column({nullable: true})
    dateType: string;         // arrivalDate/departureDate/prorated

    @Column({ nullable: true })
    listingMapIds: string;

    @Column({ nullable: true })
    statementName: string;

    @Column({ nullable: true })
    statementId: number;

    @Column({ nullable: true })
    durationType: string;   // weekly/bi-weekly/monthly

    @Column({ type: "float", nullable: true })
    grandTotal: number;

    @Column({ nullable: true })
    propertyOwnerName: string;

    @Column({ nullable: true })
    propertyOwnerPhone: string;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;
}
