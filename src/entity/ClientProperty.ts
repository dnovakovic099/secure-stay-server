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

    @Column({ nullable: true })
    status: string;  // draft, ready, published

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
