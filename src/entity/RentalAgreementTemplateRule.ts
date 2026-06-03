import {
    Column,
    CreateDateColumn,
    Entity,
    JoinColumn,
    ManyToOne,
    PrimaryGeneratedColumn,
    UpdateDateColumn,
} from "typeorm";
import { Listing } from "./Listing";
import { RentalAgreementTemplate } from "./RentalAgreementTemplate";

@Entity("rental_agreement_template_rules")
export class RentalAgreementTemplateRule {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "bigint" })
    listingId: number;

    @ManyToOne(() => Listing, { nullable: false })
    @JoinColumn({ name: "listingId", referencedColumnName: "id" })
    listing: Listing;

    @Column({ type: "int", nullable: true })
    channelId: number | null;

    @Column({ length: 100, nullable: true })
    channelName: string | null;

    @Column({ type: "int" })
    templateId: number;

    @ManyToOne(() => RentalAgreementTemplate, { nullable: false })
    @JoinColumn({ name: "templateId" })
    template: RentalAgreementTemplate;

    @Column({ default: true })
    isActive: boolean;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}
