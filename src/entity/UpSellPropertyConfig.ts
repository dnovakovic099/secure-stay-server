import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "upsell_property_config" })
export class UpSellPropertyConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "int", nullable: false })
  upSellId: number;

  @Column({ type: "bigint", nullable: false })
  listingId: number;

  @Column({ type: "varchar", length: 100, nullable: true })
  serviceType: string | null;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  actualFee: number | null;

  @Column({ type: "decimal", precision: 5, scale: 2, nullable: true })
  processingFee: number | null;

  @Column({ type: "varchar", length: 50, nullable: true })
  chargeType: string | null;

  @Column({ type: "decimal", precision: 10, scale: 2, nullable: true })
  upsellFee: number | null;

  @Column({ type: "text", nullable: true })
  internalNotes: string | null;
}
