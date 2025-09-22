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


@Entity("property_service_info")
export class PropertyServiceInfo {
    @PrimaryGeneratedColumn()
    id: string;

    @Column({ nullable: true })
    managementFee: string;

    @Column({ nullable: true })
    serviceType: string;

    @Column({ type: "text", nullable: true })
    contractLink: string;

    @Column({ type: "text", nullable: true })
    serviceNotes: string;


    @OneToOne(() => ClientPropertyEntity, (property) => property.serviceInfo, { onDelete: "CASCADE" })
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
