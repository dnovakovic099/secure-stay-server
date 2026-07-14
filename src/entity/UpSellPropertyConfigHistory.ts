import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "upsell_property_config_history" })
export class UpSellPropertyConfigHistory {
  @PrimaryGeneratedColumn({ type: "int" })
  id: number;

  @Column({ type: "int" })
  upSellId: number;

  @Column({ type: "bigint" })
  listingId: number;

  @Column({ type: "varchar", length: 100, nullable: true })
  fieldName: string | null;

  @Column({ type: "text", nullable: true })
  oldValue: string | null;

  @Column({ type: "text", nullable: true })
  newValue: string | null;

  @Column({ type: "varchar", length: 50, default: "UPDATE" })
  action: "CREATE" | "UPDATE" | "DELETE" | "SYNC" | "UNSYNC";

  @Column({ type: "varchar", length: 255 })
  changedBy: string;

  @CreateDateColumn({ type: "timestamp" })
  changedAt: Date;
}
