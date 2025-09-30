import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    OneToOne,
    JoinColumn,
} from "typeorm";
import { ClientPropertyEntity } from "./ClientProperty";


@Entity("property_onboarding")
export class PropertyOnboarding {
    @PrimaryGeneratedColumn()
    id: string;

    //sales
    @Column({ nullable: true })
    salesRepresentative: string;

    @Column({ type: "text", nullable: true })
    salesNotes: string;

    @Column({ nullable: true })
    projectedRevenue: string;


    //listing
    @Column({ type: "text", nullable: true })
    clientCurrentListingLink: string;

    @Column({ nullable: true })
    listingOwner: string;

    @Column({ nullable: true })
    clientListingStatus: string;

    @Column({ nullable: true })
    targetLiveDate: string;

    @Column({ nullable: true })
    actualLiveDate: string;

    @Column({ nullable: true })
    targetStartDate: string;

    @Column({ nullable: true })
    actualStartDate: string;

    @Column({ type: "text", nullable: true })
    targetDateNotes: string;

    @Column({ type: "text", nullable: true })
    upcomingReservations: string;

    //client facing fields
    @Column({ type: "boolean", default: false })
    acknowledgePropertyReadyByStartDate: boolean;
    
    @Column({ type: "boolean", default: false })
    agreesUnpublishExternalListings: boolean;

    @Column({ type: "text", nullable: true })
    externalListingNotes: string;

    @Column({ type: "boolean", default: false })
    acknowledgesResponsibilityToInform: boolean;


    //photography
    @Column({ nullable: true })
    photographyCoverage: string;

    @Column({ nullable: true })
    expenseId: string;

    @Column({ type: "text", nullable: true })
    photographyNotes: string;


    @OneToOne(() => ClientPropertyEntity, (property) => property.onboarding, { onDelete: "CASCADE" })
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
