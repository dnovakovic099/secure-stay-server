import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export type SalesLeadCategory = "arbitrage" | "acquisition" | "property_management" | "internal_upsell";

// "no_contact" = suppression record: skip trace found no phone/email, kept so
// we don't pay to re-trace the same address within the dedupe window.
export type SalesLeadStatus = "new" | "contacted" | "interested" | "dead" | "won" | "no_contact";

@Entity("sales_leads")
export class SalesLeadEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "date" })
  reportDate: string;

  @Column({ type: "varchar", length: 40 })
  category: SalesLeadCategory;

  @Column({ type: "varchar", length: 120, nullable: true })
  market: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  ownerName: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  phone: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  phoneType: string;

  @Column({ type: "tinyint", default: 0 })
  phoneDnc: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  email: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  propertyAddress: string;

  @Column({ type: "varchar", length: 120, nullable: true })
  city: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  state: string;

  @Column({ type: "varchar", length: 20, nullable: true })
  zip: string;

  @Column({ type: "text", nullable: true })
  hook: string;

  @Column({ type: "text", nullable: true })
  pitch: string;

  @Column({ type: "float", nullable: true })
  score: number;

  @Column({ type: "varchar", length: 20, default: "new" })
  status: SalesLeadStatus;

  @Column({ type: "varchar", length: 60, nullable: true })
  source: string;

  @Column({ type: "varchar", length: 60, nullable: true })
  externalPropertyId: string;

  // Non-unique on purpose: the same property may legitimately re-enter the
  // report after the dedupe window expires; the 90-day lookback query is the
  // dedupe mechanism, not a constraint.
  @Index()
  @Column({ type: "varchar", length: 191 })
  dedupeKey: string;

  @Column({ type: "longtext", nullable: true })
  rawData: string;

  @CreateDateColumn({ type: "datetime" })
  createdAt: Date;

  @UpdateDateColumn({ type: "datetime" })
  updatedAt: Date;
}
