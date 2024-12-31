import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from "typeorm";

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
  @CreateDateColumn({ type: "timestamp", default: () => "CURRENT_TIMESTAMP" })
  createdAt: Date;

  @UpdateDateColumn({
    type: "timestamp",
    default: () => "CURRENT_TIMESTAMP",
    onUpdate: "CURRENT_TIMESTAMP",
  })
  updatedAt: Date;

  @DeleteDateColumn({ type: "timestamp", nullable: true })
  deletedAt: Date;

  @Column({ type: "varchar", length: 255, nullable: true })
  previewDocumentLink: string;
}
