import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    OneToOne,
    JoinColumn,
    OneToMany,
} from "typeorm";
import { ClientPropertyEntity } from "./ClientProperty";
import { PropertyBedTypes } from "./PropertyBedTypes";


@Entity("property_info")
export class PropertyInfo {
    @PrimaryGeneratedColumn()
    id: string;

    //required fields for HA
    @Column({ type: "text", nullable: true })
    externalListingName: string;

    @Column({ nullable: true })
    address: string;

    @Column({ nullable: true })
    currencyCode: string;

    @Column({ type: "float", nullable: true })
    price: number;

    @Column({ type: "float", nullable: true })
    priceForExtraPerson: number;

    @Column({ type: "int", nullable: true })
    guestsIncluded: number;


    //general
    @Column({ nullable: true })
    propertyTypeId: number;

    @Column({ nullable: true })
    noOfFloors: number;

    @Column({ nullable: true })
    squareMeters: number;

    @Column({ nullable: true })
    personCapacity: number;   //Maximum Capacity


    //bedrooms
    @Column({ nullable: true })
    roomType: string;

    @Column({ nullable: true })
    bedroomsNumber: number;


    //bedroom location and bed types
    @OneToMany(() => PropertyBedTypes, (bedType) => bedType.propertyId, {
        cascade: true,
        eager: false,
        onDelete: "CASCADE"
    })
    propertyBedTypes: PropertyBedTypes[];


    //bathrooms
    @Column({ nullable: true })
    bathroomType: string;

    @Column({ nullable: true })
    bathroomsNumber: number;         // Number of Full Baths

    @Column({ nullable: true })
    guestBathroomsNumber: number;    // Number of Half Baths


    //Listing Information
    @Column({ type: "int", nullable: true })
    checkOutTime: number;    //Accepted values are 0-23

    @Column({ type: "int", nullable: true })
    checkInTimeStart: number;    //Accepted values are 0-23

    @Column({ type: "int", nullable: true })
    checkInTimeEnd: number;    //Accepted values are 0-23

    @Column({ nullable: true })
    canAnyoneBookAnytime: string;

    @Column({ type: "text", nullable: true })
    bookingAcceptanceNoticeNotes: string;


    @OneToOne(() => ClientPropertyEntity, (property) => property.propertyInfo, { onDelete: "CASCADE" })
    @JoinColumn()
    clientProperty: ClientPropertyEntity;


    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date;

    @Column()
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;
}
