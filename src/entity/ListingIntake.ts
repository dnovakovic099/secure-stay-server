// Import necessary modules from TypeORM
import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    OneToMany,
    CreateDateColumn,
    DeleteDateColumn,
    UpdateDateColumn,
} from "typeorm";
import { ListingIntakeBedTypes } from "./ListingIntakeBedTypes";

@Entity("listing_intake") // Specify the name of your MySQL table
export class ListingIntake {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    clientName: string;

    @Column()
    clientContact: string;

    // Basic Info starts...

    @Column({ type: "text", nullable: true })
    externalListingName: string;

    @Column({ type: "text", nullable: true })
    tags: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ nullable: true })
    personCapacity: number;

    @Column({ nullable: true })
    propertyTypeId: number;

    @Column({ nullable: true })
    roomType: string;

    @Column({ nullable: true })
    bedroomsNumber: number;

    @Column({ nullable: true })
    bedsNumber: number;

    @Column({ nullable: true })
    bathroomsNumber: number;

    @Column({ nullable: true })
    bathroomType: string;

    @Column({ nullable: true })
    guestBathroomsNumber: number;

    // Basic info ends


    //Address starts...
    @Column({ nullable: true })
    address: string;

    @Column({ nullable: true })
    publicAddress: string;

    @Column({ nullable: true })
    country: string;

    @Column({ nullable: true })
    countryCode: string;

    @Column({ nullable: true })
    state: string;

    @Column({ nullable: true })
    city: string;

    @Column({ nullable: true })
    street: string;

    @Column({ nullable: true })
    zipcode: string;

    @Column({ nullable: true })
    timeZoneName: string;

    //Address ends...

    //amenities start...
    @Column({ type: "text", nullable: true })
    amenities: string;
    //amenities ends...

    //price & fees start...

    @Column({ nullable: true })
    currencyCode: string;
    
    @Column({ type: "float", nullable: true })
    price: number;

    @Column({ type: "float", nullable: true })
    priceForExtraPerson: number;

    @Column({ type: "float", nullable: true })
    guestsIncluded: number;

    @Column({ type: "float", nullable: true })
    cleaningFee: number;

    @Column({ type: "float", nullable: true })
    airbnbPetFeeAmount: number;

    //price & fees ends...

    //additional info & policies start...

    @Column({ type: "text", nullable: true })
    houseRules: string;

    @Column({ type: "int", nullable: true })
    checkOutTime: number;    //Accepted values are 0-23

    @Column({ type: "int", nullable: true })
    checkInTimeStart: number;    //Accepted values are 0-23

    @Column({ type: "int", nullable: true })
    checkInTimeEnd: number;    //Accepted values are 0-23

    @Column({ type: "int", nullable: true })
    squareMeters: number;

    @Column({ nullable: true })
    language: string;

    @Column({ type: "boolean", nullable: true })
    instantBookable: boolean;

    @Column({ nullable: true })
    wifiUsername: string;

    @Column({ nullable: true })
    wifiPassword: string;

    @Column({ nullable: true })
    cancellationPolicy: string;

    @Column({ nullable: true })
    airBnbCancellationPolicyId: number;

    @Column({ nullable: true })
    bookingCancellationPolicyId: number;

    @Column({ nullable: true })
    marriottBnbCancellationPolicyId: number;

    @Column({ nullable: true })
    vrboCancellationPolicyId: number;

    @Column({ nullable: true })
    cancellationPolicyId: number;

    //additional info & policies ends...

    //booking settings start...

    @Column({ nullable: true })
    minNights: number;

    @Column({ nullable: true })
    maxNights: number;

    //booking settings end...

    //channel specific start...
    @Column({ nullable: true })
    airbnbName: string;

    @Column({ type: "text", nullable: true })
    airbnbSummary: string;

    @Column({ type: "text", nullable: true })
    airbnbSpace: string;

    @Column({ type: "text", nullable: true })
    airbnbAccess: string;

    @Column({ type: "text", nullable: true })
    airbnbInteraction: string;

    @Column({ type: "text", nullable: true })
    airbnbNeighborhoodOverview: string;

    @Column({ type: "text", nullable: true })
    airbnbTransit: string;

    @Column({ type: "text", nullable: true })
    airbnbNotes: string;

    @Column({ nullable: true })
    homeawayPropertyName: string;

    @Column({ nullable: true })
    homeawayPropertyHeadline: string;

    @Column({ type: "text", nullable: true })
    homeawayPropertyDescription: string;

    @Column({ nullable: true })
    bookingcomPropertyName: string;

    @Column({ nullable: true })
    bookingcomPropertyRoomName: string;

    @Column({ type: "text", nullable: true })
    bookingcomPropertyDescription: string;

    @Column({ nullable: true })
    marriottListingName: string;

    //channel specific end...

    //Owner, Contact and Invoicing start...

    @Column({ nullable: true })
    contactName: string;

    @Column({ nullable: true })
    contactPhone1: string;

    @Column({ nullable: true })
    contactLanguage: string;

    //Owner, Contact and Invoicing end...

    //bed types
    @OneToMany(() => ListingIntakeBedTypes, (bedType) => bedType.listingIntakeId, {
        cascade: true,
        onDelete: "CASCADE"
    })
    listingBedTypes: ListingIntakeBedTypes[];


    //license info start...

    @Column({ nullable: true })
    propertyLicenseNumber: string;

    @Column({ nullable: true })
    propertyLicenseType: string;

    @Column({ nullable: true })
    propertyLicenseIssueDate: string;

    @Column({ nullable: true })
    propertyLicenseExpirationDate: string;

    //license info ends...

    @Column({ nullable: true })
    status: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;

    @Column({ nullable: true })
    listingId: number;
}
