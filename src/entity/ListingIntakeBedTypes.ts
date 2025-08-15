import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ListingIntake } from './ListingIntake';

@Entity('listing_intake_bed_types')
export class ListingIntakeBedTypes {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    bedTypeId: number;

    @Column()
    quantity: number;

    @Column()
    bedroomNumber:number;

    @ManyToOne(() => ListingIntake, (listing) => listing.listingBedTypes, {
        onDelete: "CASCADE"
    })
    @JoinColumn({ name: "listingIntakeId" })
    listingIntakeId: number;
}