import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  OneToMany,
} from "typeorm";

@Entity("client_management")
export class ClientEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  firstName: string;

  @Column()
  lastName: string;

  @Column()
  preferredName: string;

  @Column()
  timezone: string;

  @Column({ unique: true })
  email: string;

  @Column()
  phone: string;

  @Column()
  dialCode: string;

  @Column({
    type: "enum",
    enum: ["Active", "Inactive", "Pending", "Suspended"],
    default: "Active"
  })
  status: string;

  @Column({ nullable: true })
  companyName: string;

  @Column({ type: "text", nullable: true })
  notes: string;

  @Column({ type: "int", nullable: true })
  propertyId: number;

  @Column({ type: "int", default: 0 })
  totalBookings: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  totalSpent: number;

  @Column({ type: "timestamp", nullable: true })
  lastBookingDate: Date;

  @Column({ type: "simple-array", nullable: true })
  tags: string[];

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updatedAt: Date;

  @DeleteDateColumn({ type: "timestamp", nullable: true })
  deletedAt: Date;

  @Column()
  createdBy: string;

  @Column({ nullable: true })
  updatedBy: string;

  @Column({ nullable: true })
  deletedBy: string;
}
