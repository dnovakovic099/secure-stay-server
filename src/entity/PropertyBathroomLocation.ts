import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PropertyInfo } from './PropertyInfo';

@Entity('property_bathroom_location')
export class PropertyBathroomLocation {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    floorLevel: number;

    @Column({ nullable: true })
    bathroomType: string;

    @Column({ nullable: true })
    bathroomNumber: number;

    @Column({ nullable: true })
    ensuite: number;

    @Column({ nullable: true })
    bathroomFeatures: string;

    @Column({ nullable: true })
    privacyType: string;

    @ManyToOne(() => PropertyInfo, (listing) => listing.propertyBathroomLocation, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyId: PropertyInfo;
}