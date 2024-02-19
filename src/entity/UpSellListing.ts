
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';


@Entity({ name: 'upsell_listing' })
export class UpSellListing {
    @PrimaryGeneratedColumn()
    id: Number;

    @Column({ type: "int", nullable: false })
    listingId: Number;

    @Column({ type: "int", nullable: false })
    upSellId: Number;

    @Column({ type: 'int', nullable: false, default: 1 })
    status: Number
}