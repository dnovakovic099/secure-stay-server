import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from "typeorm";
import { RentalAgreementTemplate } from "./RentalAgreementTemplate";

@Entity("rental_agreement_signings")
export class RentalAgreementSigning {
    @PrimaryGeneratedColumn()
    id: number;

    // ReservationInfoEntity.id (Hostify's integer reservation ID) stored as string — used as the URL key
    @Column({ length: 200 })
    hostifyReservationId: string;

    // FK to reservation_info.id (integer PK) for joins — nullable since lookup may fail
    @Column({ nullable: true })
    reservationInfoId: number;

    @ManyToOne(() => RentalAgreementTemplate, { eager: false, onDelete: "RESTRICT" })
    @JoinColumn({ name: "templateId" })
    template: RentalAgreementTemplate;

    @Column()
    templateId: number;

    // Agreement HTML with {{placeholders}} resolved at signing time
    @Column({ type: "longtext" })
    renderedHtml: string;

    // Base64 PNG from react-signature-canvas
    @Column({ type: "mediumtext" })
    signatureDataUrl: string;

    @Column({ length: 200 })
    signedByName: string;

    @Column({ length: 200, nullable: true })
    signedByEmail: string;

    @Column({ length: 50, nullable: true })
    ipAddress: string;

    @Column({ length: 512, nullable: true })
    userAgent: string;

    @Column({ type: "timestamp" })
    signedAt: Date;

    // FK to FileInfo.id once the PDF is uploaded to Google Drive
    @Column({ nullable: true })
    fileInfoId: number;

    // "pending_pdf" | "pdf_ready" | "pdf_failed"
    @Column({ length: 50, default: "pending_pdf" })
    pdfStatus: string;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
