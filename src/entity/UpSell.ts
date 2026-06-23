import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

//define the entity class
@Entity({ name: 'upsell_info' })
export class UpSellEntity {

    //define the primary key
    @PrimaryGeneratedColumn({ name: 'upsell_id' })
    upSellId: Number

    @Column({ type: 'varchar', length: 50, nullable: false })
    title: String

    @Column({ type: 'varchar', length: 100, nullable: true })
    serviceType: String

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false, default: 0 })
    price: number

    @Column({ type: 'varchar', default: 'Per Booking - Onetime', length: 50, nullable: true })
    timePeriod: String

    @Column({ type: 'varchar', default: 'Always', length: 50, nullable: true })
    availability: String

    @Column({ type: 'varchar', length: 500, nullable: false })
    description: String

    @Column({ type: 'text', nullable: true })
    internalNotes: String

    @Column({ type: 'tinyint', default: 1, nullable: false, })
    status: Number

    @Column({ type: 'varchar', length: 200, nullable: true, })
    image: String

    @Column({ type: "bool", default: 1, nullable: false })
    isActive: Boolean

    @Column({ type: "bool", default: 0, nullable: false })
    isDefault: Boolean

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: false, default: 0 })
    actualFee: number

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: false, default: 0 })
    pmFee: number

    @Column({ type: 'decimal', precision: 5, scale: 2, nullable: false, default: 3 })
    processingFee: number
}
