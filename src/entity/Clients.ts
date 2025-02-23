import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from "typeorm";
import { ClientListingEntity } from "./ClientListings";

@Entity("clients")
export class ClientEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  leadStatus: string;

  @Column()
  propertyAddress: string;

  @Column()
  city: string;

  @Column()
  state: string;

  @Column()
  country: string;

  @Column()
  ownerName: string;

  @Column()
  salesCloser: string;

  @Column("decimal", { precision: 10, scale: 2 })
  airDnaRevenue: number;

  @Column("decimal", { precision: 10, scale: 2 })
  commissionAmount: number;

  @Column()
  commissionStatus: string;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({
    type: "timestamp",
  })
  updatedAt: Date;

  @DeleteDateColumn({ type: "timestamp", nullable: true })
  deletedAt: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  previewDocumentLink: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  listingLink: string;

  @Column({ type: "int" })
  beds: number;

  @Column({ type: "int" })
  baths: number;

  @Column({ type: "int" })
  guests: number;

  @OneToMany(() => ClientListingEntity, (listing) => listing.client)
  listings: ClientListingEntity[];
}
