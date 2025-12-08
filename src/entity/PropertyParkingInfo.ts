import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { PropertyInfo } from './PropertyInfo';

@Entity('property_parking_info')
export class PropertyParkingInfo {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    parkingType: string;

    @Column({ type: "decimal", nullable: true })
    parkingFee: number;

    @Column({ nullable: true })
    parkingFeeType: string;

    @Column({ type: "int", nullable: true })
    numberOfParkingSpots: number;

    @ManyToOne(() => PropertyInfo, (listing) => listing.propertyParkingInfo, {
        onDelete: "CASCADE"
    })
    @JoinColumn()
    propertyId: PropertyInfo;
}