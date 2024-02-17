import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

//define the entity class
@Entity({ name: 'upsell_info' })
export class UpSellEntity {

    //define the primary key
    @PrimaryGeneratedColumn({ name: 'upsell_id' })
    upSellId: Number

    //define the columns
    @Column({ type: 'date', nullable: false })
    purchaseDate: Date;

    @Column({ type: 'varchar', length: 50, nullable: true })

    @Column({ type: 'date', nullable: false })
    checkIn: Date

    @Column({ type: 'date', nullable: false })
    checkOut: Date

    @Column({ type: 'varchar', length: 50, nullable: false })
    guestName: String

    @Column({ type: 'varchar', length: 50, nullable: false })
    title: String

    @Column({ type: 'bigint', nullable: false })
    price: Number

    @Column({ type: 'varchar', length: 50, nullable: false })
    timePeriod: String

    @Column({ type: 'varchar', length: 50, nullable: true })
    pricingModel: String

    @Column({ type: 'tinyint', nullable: false, default: 0 })
    isApprovalRequired: Number

    @Column({ type: 'tinyint', nullable: false, default: 0 })
    isUpSellMandatory: Number

    @Column({ type: 'varchar', length: 500, nullable: false })
    description: String

    @Column({ type: 'tinyint', default: 1, nullable: false, })
    status: Number

    @Column({ type: 'varchar', nullable: true })
    image: String
}

