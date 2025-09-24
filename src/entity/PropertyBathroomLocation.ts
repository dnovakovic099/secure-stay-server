import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PropertyInfo } from './PropertyInfo';

@Entity('property_bathroom_location')
export class PropertyBathroomLocation {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    floorLevel: number;

    @Column()
    bathroomType: number;

    @Column()
    bathroomNumber: number;

    @Column({ nullable: true })
    ensuite: number;

    @ManyToOne(() => PropertyInfo, (listing) => listing.propertyBathroomLocation, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyId: PropertyInfo;
}