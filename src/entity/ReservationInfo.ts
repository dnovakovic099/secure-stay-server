// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

// Define the entity class
@Entity({ name: 'reservation_info' })
export class ReservationInfoEntity {
    // Define the primary key column
    @PrimaryColumn()
    id: number;

    // Define other columns
    @Column({ type: 'int', nullable: true })
    listingMapId: number;

    @Column({ nullable: true })
    listingName: string;

    @Column({ type: 'int', nullable: true })
    channelId: number;

    @Column({ nullable: true })
    source: string;

    @Column({ nullable: true })
    channelName: string;

    @Column({ nullable: true })
    reservationId: string;

    @Column({ nullable: true })
    hostawayReservationId: string;

    @Column({ nullable: true })
    channelReservationId: string;

    @Column({ nullable: true })
    externalPropertyId: string;

    @Column({ type: 'tinyint', nullable: true })
    isProcessed: boolean;

    @Column({ type: 'datetime', nullable: true })
    reservationDate: Date;

    @Column({ nullable: true })
    guestName: string;

    @Column({ nullable: true })
    guestFirstName: string;

    @Column({ nullable: true })
    guestLastName: string;

    @Column({ nullable: true })
    guestExternalAccountId: string;

    @Column({ nullable: true })
    guestZipCode: string;

    @Column({ nullable: true })
    guestAddress: string;

    @Column({ nullable: true })
    guestCity: string;

    @Column({ nullable: true })
    guestCountry: string;

    @Column({ nullable: true })
    guestEmail: string;

    @Column({ type: "text", nullable: true })
    guestPicture: string;

    @Column({ type: 'int', nullable: true })
    numberOfGuests: number;

    @Column({ type: 'int', nullable: true })
    adults: number;

    @Column({ type: 'int', nullable: true })
    children: number;

    @Column({ type: 'int', nullable: true })
    infants: number;

    @Column({ type: 'int', nullable: true })
    pets: number;

    @Column({ type: 'date', nullable: true })
    arrivalDate: Date;

    @Column({ type: 'date', nullable: true })
    departureDate: Date;

    @Column({ type: 'time', nullable: true })
    checkInTime: string;

    @Column({ type: 'time', nullable: true })
    checkOutTime: string;

    @Column({ type: 'int', nullable: true })
    nights: number;

    @Column({ nullable: true })
    phone: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    totalPrice: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    taxAmount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    channelCommissionAmount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    hostawayCommissionAmount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    cleaningFee: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    securityDepositFee: number;

    @Column({ type: 'tinyint', nullable: true })
    isPaid: boolean;

    @Column({ nullable: true })
    currency: string;

    @Column({ nullable: true })
    status: string;

    @Column({ type: 'text', nullable: true })
    hostNote: string;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbExpectedPayoutAmount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbListingBasePrice: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbListingCancellationHostFee: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbListingCancellationPayout: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbListingCleaningFee: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbListingHostFee: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbListingSecurityPrice: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbOccupancyTaxAmountPaidToHost: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbTotalPaidAmount: number;

    @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
    airbnbTransientOccupancyTaxPaidAmount: number;

    @Column({ type: "text", nullable: true })
    airbnbCancellationPolicy: string;
}