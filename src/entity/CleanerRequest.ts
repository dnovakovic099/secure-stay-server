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

@Entity("cleaner_requests")
export class CleanerRequest {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => ClientPropertyEntity, { onDelete: "CASCADE" })
    @JoinColumn({ name: "property_id" })
    property: ClientPropertyEntity;

    @Column({ name: "property_id" })
    propertyId: number;

    @Column({ type: "text", nullable: true })
    fullAddress: string;

    @Column({ type: "text", nullable: true })
    specialArrangementPreference: string;

    @Column({ type: "text", nullable: true })
    isPropertyReadyCleaned: string;

    @Column({ type: "text", nullable: true })
    scheduleInitialClean: string;

    @Column({ type: "text", nullable: true })
    propertyAccessInformation: string;

    @Column({ type: "text", nullable: true })
    cleaningClosetCodeLocation: string;

    @Column({ type: "text", nullable: true })
    trashScheduleInstructions: string;

    @Column({ type: "text", nullable: true })
    suppliesToRestock: string;

    @Column({ nullable: true, default: "new" })
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
