import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PropertyInfo } from './PropertyInfo';

@Entity('property_upsells')
export class PropertyUpsells {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    upsellName: string;

    @Column({ type: "boolean", nullable: true })
    allowUpsell: boolean;

    @Column({ nullable: true })
    feeType: string;

    @Column({ nullable: true })
    fee: number;

    @Column({ nullable: true })
    maxAdditionalHours: number;

    @ManyToOne(() => PropertyInfo, (listing) => listing.propertyUpsells, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyId: PropertyInfo;
}