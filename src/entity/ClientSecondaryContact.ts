import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    UpdateDateColumn,
    DeleteDateColumn,
    OneToMany,
    ManyToOne,
} from "typeorm";
import { ClientEntity } from "./Client";

@Entity("client_secondary_contacts")
export class ClientSecondaryContact {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column()
    firstName: string;

    @Column()
    lastName: string;

    @Column({ nullable: true })
    preferredName: string;

    @Column({ unique: true })
    email: string;

    @Column({ nullable: true })
    dialCode: string;

    @Column({ nullable: true })
    phone: string;

    @Column({ nullable: true })
    timezone: string;

    @Column({ nullable: true })
    companyName: string;

    @Column({ type: "text", nullable: true })
    notes: string;

    @Column({ nullable: true })
    type: string;

    @ManyToOne(() => ClientEntity, (client) => client.secondaryContacts, { onDelete: "CASCADE" })
    client: ClientEntity;

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
