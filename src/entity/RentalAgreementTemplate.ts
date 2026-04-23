import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("rental_agreement_templates")
export class RentalAgreementTemplate {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 255 })
    name: string;

    // HTML body with {{placeholder}} tokens:
    // {{guestName}}, {{guestFirstName}}, {{guestLastName}}, {{guestEmail}},
    // {{checkInDate}}, {{checkOutDate}}, {{propertyName}}, {{nights}},
    // {{numberOfGuests}}, {{totalPrice}}, {{currency}}, {{reservationId}}
    @Column({ type: "longtext" })
    bodyHtml: string;

    @Column({ default: true })
    isActive: boolean;

    @Column({ default: false })
    isDefault: boolean;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}
