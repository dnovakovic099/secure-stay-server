import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    OneToMany,
    ManyToOne,
    OneToOne,
} from "typeorm";
import { ClientEntity } from "./Client";
import { PropertyOnboarding } from "./PropertyOnboarding";
import { PropertyServiceInfo } from "./PropertyServiceInfo";
import { PropertyInfo } from "./PropertyInfo";

@Entity("client_properties")
export class ClientPropertyEntity {
    @PrimaryGeneratedColumn()
    id: string;

    @Column({ nullable: true })
    address: string;

    @Column({ nullable: true })
    streetAddress: string;

    @Column({ nullable: true })
    unitNumber: string;

    @Column({ nullable: true })
    city: string;

    @Column({ nullable: true })
    state: string;

    @Column({ nullable: true })
    country: string;

    @Column({ nullable: true })
    zipCode: string;

    @Column({ type: "decimal", precision: 10, scale: 6, nullable: true })
    latitude: number;

    @Column({ type: "decimal", precision: 11, scale: 6, nullable: true })
    longitude: number;

    @Column({ nullable: true })
    listingId: string;             // HA listing id

    @Column({ type: "varchar", length: 255, nullable: true })
    hostifyListingId: string;      // Hostify-specific listing ID (preserved for resume on failures)

    @Column({ nullable: true })
    status: string;  // draft, ready, published

    @Column({ nullable: true })
    hostifyPublishStatus: string;  // "pending" | "publishing" | "completed" | "failed"

    @Column({ type: "text", nullable: true })
    hostifyPublishError: string;  // JSON: { step: "layout", error: "message" }

    @Column({ type: "simple-array", nullable: true })
    hostifyCompletedSteps: string[];  // ["location", "layout", "amenities"]

    @Column({ type: "timestamp", nullable: true })
    hostifyLastPublishAttempt: Date;

    // Welcome notification tracking fields
    @Column({ name: "welcome_email_sent_at", type: "timestamp", nullable: true })
    welcomeEmailSentAt: Date;

    @Column({ name: "welcome_sms_sent_at", type: "timestamp", nullable: true })
    welcomeSmsSentAt: Date;

    // Asana task tracking fields
    @Column({ name: "asana_task_id", nullable: true })
    asanaTaskId: string;

    @Column({ name: "asana_task_url", type: "varchar", length: 500, nullable: true })
    asanaTaskUrl: string;

    @Column({ name: "asana_task_created_at", type: "timestamp", nullable: true })
    asanaTaskCreatedAt: Date;

    @Column({ name: "asana_task_error", type: "text", nullable: true })
    asanaTaskError: string;

    @ManyToOne(() => ClientEntity, (client) => client.properties, { onDelete: "CASCADE" })
    client: ClientEntity;

    @OneToOne(() => PropertyOnboarding, (onboarding) => onboarding.clientProperty, { cascade: true, eager: false, onDelete: "CASCADE" })
    onboarding: PropertyOnboarding;

    @OneToOne(() => PropertyServiceInfo, (serviceInfo) => serviceInfo.clientProperty, { cascade: true, eager: false, onDelete: "CASCADE" })
    serviceInfo: PropertyServiceInfo;

    @OneToOne(() => PropertyInfo, (propertyInfo) => propertyInfo.clientProperty, { cascade: true, eager: false, onDelete: "CASCADE" })
    propertyInfo: PropertyInfo;

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
