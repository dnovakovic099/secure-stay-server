import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";
import { ClientEntity } from "./Clients";

@Entity("clientListings")
export class ClientListingEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  clientId: number;

  @ManyToOne(() => ClientEntity, (client) => client.listings, {
    onDelete: "CASCADE",
  })
  client: ClientEntity;

  @Column({ type: "varchar", length: 255 })
  airdnaMarketName: string;

  @Column({ type: "varchar", length: 50 })
  marketType: string;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  marketScore: number;

  @Column({ type: "decimal", precision: 10, scale: 7 })
  lat: number;

  @Column({ type: "decimal", precision: 10, scale: 7 })
  lng: number;

  @Column({ type: "decimal", precision: 3, scale: 2 })
  occupancy: number;

  @Column({ type: "varchar", length: 255 })
  address: string;

  @Column({ type: "decimal", precision: 10, scale: 7 })
  cleaningFee: number;

  @Column({ type: "int" })
  revenue: number;

  @Column({ type: "int" })
  totalComps: number;

  @Column({ type: "json", nullable: true })
  comps: any;

  @Column({ type: "json", nullable: true })
  forSalePropertyComps: any;

  @Column({ type: "json", nullable: true })
  compsetAmenities: any;

  @Column({ type: "varchar", length: 20 })
  zipcode: string;

  @Column({ type: "json", nullable: true })
  revenueRange: any;

  @Column({ type: "varchar", length: 255, nullable: true })
  screenshotSessionId: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  propertyScreenshotSessionId: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  vrboPropertyId: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  airBnbPropertyId: string;

  @Column({ type: "json", nullable: true })
  metrics: any;

  @Column({ type: "json", nullable: true })
  details: any;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
