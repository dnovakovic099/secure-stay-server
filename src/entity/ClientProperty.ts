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

@Entity("client_properties")
export class ClientPropertyEntity {
    @PrimaryGeneratedColumn()
    id: string;

    @Column()
    listingId: string;

    @ManyToOne(() => ClientEntity, (client) => client.properties, { onDelete: "CASCADE" })
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
