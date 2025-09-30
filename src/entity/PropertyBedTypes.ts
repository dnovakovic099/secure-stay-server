import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PropertyInfo } from './PropertyInfo';

@Entity('property_bed_types')
export class PropertyBedTypes {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    floorLevel: number;

    @Column()
    bedTypeId: number;

    @Column()
    quantity: number;

    @Column()
    bedroomNumber: number;

    @ManyToOne(() => PropertyInfo, (listing) => listing.propertyBedTypes, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyId: PropertyInfo;
}