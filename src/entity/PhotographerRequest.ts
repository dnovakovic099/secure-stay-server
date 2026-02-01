import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    ManyToOne,
    JoinColumn,
} from "typeorm";
import { ClientPropertyEntity } from "./ClientProperty";

@Entity("photographer_requests")
export class PhotographerRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ClientPropertyEntity, { onDelete: "CASCADE" })
    @JoinColumn({ name: "property_id" })
    property: ClientPropertyEntity;

    @Column({ name: "property_id" })
    propertyId: number;

    @Column({ type: "text", nullable: true })
    ownerNamePropertyInternalName: string;

    @Column({ nullable: true })
    serviceType: string; // Launch, Pro, Full Service, Others

    @Column({ type: "text", nullable: true })
    completeAddress: string;

    @Column({ type: "int", nullable: true })
    numberOfBedrooms: number;

    @Column({ type: "int", nullable: true })
    numberOfBathrooms: number;

    @Column({ type: "int", nullable: true })
    sqftOfHouse: number;

    @Column({ type: "text", nullable: true })
    availability: string;

    @Column({ nullable: true })
    onboardingRep: string;

    @Column({ nullable: true, default: "pending" })
    status: string; // pending, scheduled, completed, cancelled

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;
}
