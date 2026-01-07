import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum CodeGenerationMode {
  PHONE = "phone",
  RANDOM = "random",
  DEFAULT = "default",
}

@Entity("property_lock_settings")
export class PropertyLockSettings {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "property_id", unique: true })
  propertyId: number;

  @Column({ name: "auto_generate_codes", default: false })
  autoGenerateCodes: boolean;

  @Column({ name: "default_access_code", nullable: true })
  defaultAccessCode: string;

  @Column({
    name: "code_generation_mode",
    type: "enum",
    enum: CodeGenerationMode,
    default: CodeGenerationMode.PHONE,
  })
  codeGenerationMode: CodeGenerationMode;

  @Column({ name: "hours_before_checkin", default: 3 })
  hoursBeforeCheckin: number;

  @Column({ name: "hours_after_checkout", default: 3 })
  hoursAfterCheckout: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
