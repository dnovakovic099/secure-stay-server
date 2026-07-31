import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("lock_fleet_inventory")
export class LockFleetInventory {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  platform: string;

  @Column({ name: "expected_count", default: 0 })
  expectedCount: number;

  @Column({ nullable: true })
  provider: string;

  @Column({ name: "automation_path", default: "api" })
  automationPath: string;

  @Column({ type: "text", nullable: true })
  notes: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
