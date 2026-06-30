import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

export type TurnoverSenderLabel =
  | "cleaner_default"
  | "cleaner_group_1"
  | "cleaner_group_2"
  | "owners";

@Entity("turnover_sender_numbers")
@Index("uq_turnover_sender_label_phone", ["label", "phone"], { unique: true })
export class TurnoverSenderNumber {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "label", type: "varchar", length: 50 })
  label: TurnoverSenderLabel;

  @Column({ name: "country_code", type: "varchar", length: 10, default: "+1" })
  countryCode: string;

  @Column({ name: "phone", type: "varchar", length: 50 })
  phone: string;

  @Column({ name: "display_name", type: "varchar", length: 150, nullable: true })
  displayName: string | null;

  @Column({ name: "is_active", type: "tinyint", default: 1 })
  isActive: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @Column({ name: "updated_by", type: "varchar", length: 255, nullable: true })
  updatedBy: string | null;
}
