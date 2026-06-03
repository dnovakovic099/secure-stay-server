import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
} from "typeorm";

@Entity("rental_agreement_reservation_documents")
export class RentalAgreementReservationDocument {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ length: 200, unique: true })
    hostifyReservationId: string;

    @Column({ nullable: true })
    reservationInfoId: number | null;

    @Column({ nullable: true })
    sourceTemplateId: number | null;

    @Column({ type: "longtext", nullable: true })
    headerHtml: string | null;

    @Column({ type: "longtext", nullable: true })
    bodyHtml: string | null;

    @Column({ type: "longtext", nullable: true })
    footerHtml: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    emailSubject: string | null;

    @Column({ type: "longtext", nullable: true })
    emailBodyHtml: string | null;

    @Column({ default: false })
    isEdited: boolean;

    @Column({ default: false })
    isOverridden: boolean;

    @Column({ type: "text", nullable: true })
    overrideReason: string | null;

    @Column({ type: "timestamp", nullable: true })
    overriddenAt: Date | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    overriddenBy: string | null;

    @Column({ type: "timestamp", nullable: true })
    lastEditedAt: Date | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    lastEditedBy: string | null;

    @Column({ type: "timestamp", nullable: true })
    firstViewedAt: Date | null;

    @Column({ type: "timestamp", nullable: true })
    lastViewedAt: Date | null;

    @Column({ default: false })
    skipIdUpload: boolean;

    @Column({ type: "timestamp", nullable: true })
    skipIdUploadAt: Date | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    skipIdUploadBy: string | null;

    @Column({ type: "text", nullable: true })
    skipIdUploadReason: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
