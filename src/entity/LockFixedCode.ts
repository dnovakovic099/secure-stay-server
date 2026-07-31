import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("lock_fixed_codes")
export class LockFixedCode {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "property_name" })
  propertyName: string;

  @Column({ name: "property_id", nullable: true })
  propertyId: number;

  @Column()
  platform: string;

  @Column()
  code: string;

  @Column({ type: "text", nullable: true })
  notes: string;

  @Column({ name: "account_email", nullable: true })
  accountEmail: string;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
