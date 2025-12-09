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
import { PropertyUpsells } from "./PropertyUpsells";
import { PropertyVendorManagement } from "./PropertyVendorManagement";
import { PropertyParkingInfo } from "./PropertyParkingInfo";
import { PropertyBathroomLocation } from "./PropertyBathroomLocation";


@Entity("property_info")
export class PropertyInfo {
    @PrimaryGeneratedColumn()
    id: string;

    //required fields for HA
    @Column({ type: "text", nullable: true })
    externalListingName: string;

    @Column({ type: "text", nullable: true })
    internalListingName: string;

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

    @Column({ nullable: true })
    extraGuestFeeType: string;


    //general
    @Column({ nullable: true })
    propertyTypeId: string;

    @Column({ nullable: true })
    propertyType: string;

    @Column({ nullable: true })
    noOfFloors: number;

    @Column({ nullable: true })
    unitFloor: string;  // Unit Floor (If applicable)

    @Column({ nullable: true })
    squareMeters: number;

    @Column({ nullable: true })
    squareFeet: number;

    @Column({ nullable: true })
    personCapacity: number;   //Maximum Capacity


    //bedrooms
    @Column({ nullable: true })
    roomType: string;

    @Column({ nullable: true })
    bedroomsNumber: number;

    @Column({ type: "text", nullable: true })
    bedroomNotes: string;


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

    @Column({ type: "text", nullable: true })
    bathroomNotes: string;

    //bathroom location and types
    @OneToMany(() => PropertyBathroomLocation, (bedType) => bedType.propertyId, {
        cascade: true,
        eager: false,
        onDelete: "CASCADE"
    })
    propertyBathroomLocation: PropertyBathroomLocation[];

    

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

    @Column({ type: "text", nullable: true })
    calendarManagementNotes: string;

    //House Rules
    @Column({ type: "boolean", nullable: true })
    allowPartiesAndEvents: boolean;

    @Column({ type: "boolean", nullable: true })
    allowSmoking: boolean;

    @Column({ type: "boolean", nullable: true })
    allowPets: boolean;

    @Column({ type: "decimal", nullable: true })
    petFee: number;

    @Column({ nullable: true })
    petFeeType: string;

    @Column({ type: "int", nullable: true })
    numberOfPetsAllowed: number;

    @Column({ type: "text", nullable: true })
    petRestrictionsNotes: string;

    @Column({ type: "text", nullable: true })
    otherHouseRules: string;

    @Column({ type: "boolean", nullable: true })
    allowChildreAndInfants: boolean;

    @Column({ type: "text", nullable: true })
    childrenInfantsRestrictionReason: string;

    @Column({ type: "boolean", nullable: true })
    allowLuggageDropoffBeforeCheckIn: boolean;


    //Parking
    @OneToMany(() => PropertyParkingInfo, (parkingInfo) => parkingInfo.propertyId, {
        cascade: true,
        eager: false,
        onDelete: "CASCADE"
    })
    propertyParkingInfo: PropertyParkingInfo[];

    @Column({ type: "text", nullable: true })
    parkingInstructions: string;


    // Property Access
    @Column({ type: "simple-array", nullable: true })
    checkInProcess: string[];

    @Column({ type: "simple-array", nullable: true })
    doorLockType: string[];

    @Column({ nullable: true })
    doorLockCodeType: string;

    @Column({ nullable: true })
    codeResponsibleParty: string; // e.g. "Client", "Luxury Lodging"

    @Column({ type: "boolean", nullable: true })
    responsibilityToSetDoorCodes: boolean;

    @Column({ nullable: true })
    standardDoorCode: string;

    @Column({ nullable: true })
    doorLockAppName: string;

    @Column({ nullable: true })
    doorLockAppUsername: string;

    @Column({ nullable: true })
    doorLockAppPassword: string;

    @Column({ nullable: true })
    lockboxLocation: string;

    @Column({ nullable: true })
    lockboxCode: string;

    @Column({ type: "text", nullable: true })
    doorLockInstructions: string;


    // Waste Management Information
    @Column({ type: "text", nullable: true })
    wasteCollectionDays: string;

    @Column({ type: "text", nullable: true })
    wasteBinLocation: string;

    @Column({ type: "text", nullable: true })
    wasteManagementInstructions: string;


    //Additional Services/Upsells
    @OneToMany(() => PropertyUpsells, (upsell) => upsell.propertyId, {
        cascade: true,
        eager: false,
        onDelete: "CASCADE"
    })
    propertyUpsells: PropertyUpsells[];

    @Column({ type: "text", nullable: true })
    additionalServiceNotes: string;


    //Special Instructions for guests
    @Column({ type: "text", nullable: true })
    checkInInstructions: string;

    @Column({ type: "text", nullable: true })
    checkOutInstructions: string;


    //Contractors/Vendor Management
    @OneToOne(() => PropertyVendorManagement, (vendorManagementInfo) => vendorManagementInfo.propertyInfo, { cascade: true, eager: false, onDelete: "CASCADE" })
    vendorManagementInfo: PropertyVendorManagement;


    //Management
    @Column({ nullable: true })
    specialInstructions: string;

    @Column({ type: 'int', nullable: true })
    leadTimeDays: number;

    @Column({ type: 'text', nullable: true })
    bookingAcceptanceNotes: string;

    @Column({ type: 'text', nullable: true })
    managementNotes: string;


    //Financials
    @Column({ type: "float", nullable: true })
    minPrice: number;

    @Column({ type: "float", nullable: true })
    minPriceWeekday: number;

    @Column({ type: "float", nullable: true })
    minPriceWeekend: number;

    @Column({ nullable: true })
    minNights: number;

    @Column({ nullable: true })
    minNightsWeekday: number;

    @Column({ nullable: true })
    minNightsWeekend: number;

    @Column({ nullable: true })
    maxNights: number;

    @Column({ nullable: true })
    pricingStrategyPreference: string;

    @Column({ nullable: true })
    minimumNightsRequiredByLaw: string;

    @Column({ nullable: true })
    propertyLicenseNumber: string;

    @Column({ type: "text", nullable: true })
    tax: string;

    @Column({ type: "text", nullable: true })
    financialNotes: string;

    @Column({ nullable: true })
    statementSchedule: string;

    @Column({ nullable: true })
    statementType: string;

    @Column({ nullable: true })
    payoutMethod: string;

    @Column({ nullable: true })
    claimFee: string;

    @Column({ type: "text", nullable: true })
    claimFeeNotes: string;

    @Column({ nullable: true })
    techFee: string;

    @Column({ nullable: true })
    techFeeNotes: string;

    @Column({ nullable: true })
    onboardingFee: string;

    @Column({ type: "text", nullable: true })
    onboardingFeeAmountAndConditions: string;

    @Column({ nullable: true })
    offboardingFee: string;

    @Column({ type: "text", nullable: true })
    offboardingFeeAmountAndConditions: string;

    @Column({ nullable: true })
    payoutSchdule: string;

    @Column({ nullable: true })
    taxesAddedum: string;


    //amenities
    @Column({ type: "simple-array", nullable: true })
    amenities: string[];

    @Column({ type: "text", nullable: true })
    locationOfThemostat: string;

    @Column({ type: "text", nullable: true })
    heatControlInstructions: string;

    @Column({ nullable: true })
    wifiAvailable: string;  // Yes/No

    @Column({ nullable: true })
    wifiUsername: string;

    @Column({ nullable: true })
    wifiPassword: string;

    @Column({ nullable: true })
    wifiSpeed: string;

    @Column({ type: "text", nullable: true })
    locationOfModem: string;

    @Column({ type: "boolean", nullable: true })
    ethernetCable: boolean;

    @Column({ type: "boolean", nullable: true })
    pocketWifi: boolean;

    @Column({ type: "boolean", nullable: true })
    paidWifi: boolean;

    @Column({ type: "text", nullable: true })
    swimmingPoolNotes: string;

    @Column({ type: "text", nullable: true })
    hotTubInstructions: string;

    @Column({ type: "text", nullable: true })
    firePlaceNotes: string;

    @Column({ type: "text", nullable: true })
    firepitNotes: string;

    @Column({ nullable: true })
    firepitType: string;

    // Game Console Details
    @Column({ nullable: true })
    gameConsoleType: string;

    @Column({ type: "text", nullable: true })
    gameConsoleNotes: string;

    // Safe Box Details
    @Column({ type: "text", nullable: true })
    safeBoxLocationInstructions: string;

    // Gym Details
    @Column({ nullable: true })
    gymPrivacy: string;

    @Column({ type: "text", nullable: true })
    gymNotes: string;

    // Sauna Details
    @Column({ nullable: true })
    saunaPrivacy: string;

    @Column({ type: "text", nullable: true })
    saunaNotes: string;

    // Exercise Equipment Details
    @Column({ type: "text", nullable: true })
    exerciseEquipmentTypes: string;

    @Column({ type: "text", nullable: true })
    exerciseEquipmentNotes: string;

    // Golf Details
    @Column({ nullable: true })
    golfType: string;

    @Column({ type: "text", nullable: true })
    golfNotes: string;

    // Basketball Details
    @Column({ nullable: true })
    basketballPrivacy: string;

    @Column({ type: "text", nullable: true })
    basketballNotes: string;

    // Tennis Details
    @Column({ nullable: true })
    tennisPrivacy: string;

    @Column({ type: "text", nullable: true })
    tennisNotes: string;

    // Dedicated Workspace Details
    @Column({ nullable: true })
    workspaceLocation: string;

    @Column({ type: "text", nullable: true })
    workspaceInclusion: string;

    @Column({ type: "text", nullable: true })
    workspaceNotes: string;

    // Boat Dock Details
    @Column({ nullable: true })
    boatDockPrivacy: string;

    @Column({ type: "text", nullable: true })
    boatDockNotes: string;

    // Standard Booking Settings
    @Column({ type: "boolean", nullable: true })
    instantBooking: boolean;

    @Column({ type: "text", nullable: true })
    instantBookingNotes: string;

    @Column({ type: "boolean", nullable: true })
    minimumAdvanceNotice: boolean;

    @Column({ type: "text", nullable: true })
    minimumAdvanceNoticeNotes: string;

    @Column({ type: "boolean", nullable: true })
    preparationDays: boolean;

    @Column({ type: "text", nullable: true })
    preparationDaysNotes: string;

    @Column({ type: "boolean", nullable: true })
    bookingWindow: boolean;

    @Column({ type: "text", nullable: true })
    bookingWindowNotes: string;

    @Column({ type: "boolean", nullable: true })
    minimumStay: boolean;

    @Column({ type: "text", nullable: true })
    minimumStayNotes: string;

    @Column({ type: "boolean", nullable: true })
    maximumStay: boolean;

    @Column({ type: "text", nullable: true })
    maximumStayNotes: string;

    // Security Camera Details
    @Column({ type: "text", nullable: true })
    securityCameraLocations: string;

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
