import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from "typeorm";
import { ClientPropertyEntity } from "./ClientProperty";
import { ClientSecondaryContact } from "./ClientSecondaryContact";

@Entity("client_management")
export class ClientEntity {
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

  @Column({ nullable: true })
  status: string;

  @Column({ type: "text", nullable: true })
  notes: string;

  @Column({ nullable: true })
  serviceType: string;

  @OneToMany(() => ClientPropertyEntity, (property) => property.client)
  properties: ClientPropertyEntity[];

  @OneToMany(() => ClientSecondaryContact, (contact) => contact.client)
  secondaryContacts: ClientSecondaryContact[];

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
