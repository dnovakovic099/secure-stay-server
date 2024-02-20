import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

//define the entity class
@Entity({ name: 'upsell_info' })
export class UpSellEntity {

    //define the primary key
    @PrimaryGeneratedColumn({ name: 'upsell_id' })
    upSellId: Number

    @Column({ type: 'varchar', length: 50, nullable: false })
    title: String

    @Column({ type: 'bigint', nullable: false })
    price: Number

    @Column({ type: 'varchar', length: 50, nullable: true })
    timePeriod: String

    @Column({ type: 'varchar', default: 'Always', length: 50, nullable: true })
    availability: String

    @Column({ type: 'varchar', length: 500, nullable: false })
    description: String

    @Column({ type: 'tinyint', default: 1, nullable: false, })
    status: Number

    @Column({ type: 'varchar', length: 200, nullable: true, })
    image: String

    @Column({ type: "bool", default: 1, nullable: false })
    isActive: Boolean
}

