import { Entity, PrimaryGeneratedColumn, Column, PrimaryColumn } from 'typeorm';

@Entity({ name: 'reservation_info' })
export class ReservationInfoEntity {
    @PrimaryColumn()
    id: number;

    @Column({ type: 'int', nullable: true })
    listingMapId: number;

    @Column({ length: 100, nullable: true }) // Reduced length
    listingName: string;

    @Column({ type: 'int', nullable: true })
    channelId: number;

    @Column({ length: 50, nullable: true }) // Reduced length
    source: string;

    @Column({ length: 100, nullable: true }) // Reduced length
    channelName: string;

    @Column({ length: 200, nullable: true }) // Reduced length
    reservationId: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    hostawayReservationId: string;

    @Column({ length: 200, nullable: true }) // Reduced length
    channelReservationId: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    externalPropertyId: string;

    @Column({ type: 'tinyint', nullable: true })
    isProcessed: boolean;

    @Column({ type: 'datetime', nullable: true })
    reservationDate: Date;

    @Column({ length: 100, nullable: true }) // Reduced length
    guestName: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    guestFirstName: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    guestLastName: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    guestExternalAccountId: string;

    @Column({ length: 20, nullable: true }) // Reduced length
    guestZipCode: string;

    @Column({ length: 100, nullable: true }) // Reduced length
    guestAddress: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    guestCity: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    guestCountry: string;

    @Column({ length: 100, nullable: true }) // Reduced length
    guestEmail: string;

    @Column({ type: "text", nullable: true }) // Kept as TEXT
    guestPicture: string;

    @Column({ type: 'tinyint', nullable: true }) // Reduced size
    numberOfGuests: number;

    @Column({ type: 'tinyint', nullable: true }) // Reduced size
    adults: number;

    @Column({ type: 'tinyint', nullable: true }) // Reduced size
    children: number;

    @Column({ type: 'tinyint', nullable: true }) // Reduced size
    infants: number;

    @Column({ type: 'tinyint', nullable: true }) // Reduced size
    pets: number;

    @Column({ type: 'date', nullable: true })
    arrivalDate: Date;

    @Column({ type: 'date', nullable: true })
    departureDate: Date;

    @Column({ type: 'time', nullable: true })
    checkInTime: string;

    @Column({ type: 'time', nullable: true })
    checkOutTime: string;

    @Column({ type: 'int', nullable: true }) // Reduced size
    nights: number;

    @Column({ length: 20, nullable: true }) // Reduced length
    phone: string;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    totalPrice: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    taxAmount: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    channelCommissionAmount: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    hostawayCommissionAmount: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    cleaningFee: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    securityDepositFee: number;

    @Column({ type: 'tinyint', nullable: true })
    isPaid: boolean;

    @Column({ length: 10, nullable: true }) // Reduced length
    currency: string;

    @Column({ length: 50, nullable: true }) // Reduced length
    status: string;

    @Column({ type: 'text', nullable: true }) // Kept as TEXT
    hostNote: string;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbExpectedPayoutAmount: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbListingBasePrice: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbListingCancellationHostFee: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbListingCancellationPayout: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbListingCleaningFee: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbListingHostFee: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbListingSecurityPrice: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbOccupancyTaxAmountPaidToHost: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbTotalPaidAmount: number;

    @Column({ type: 'float', nullable: true }) // Replaced DECIMAL with FLOAT
    airbnbTransientOccupancyTaxPaidAmount: number;

    @Column({ type: "text", nullable: true }) // Kept as TEXT
    airbnbCancellationPolicy: string;

    @Column({ nullable: true })
    paymentStatus: string;

    @Column({ default: false })
    isProcessedInStatement: boolean;
}