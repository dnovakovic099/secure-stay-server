import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("hostify_users")
export class HostifyUser {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: "varchar", length: 255, unique: true })
  hostifyId: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  username: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  first_name: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  last_name: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  phone: string;

  @Column({ type: "boolean", default: true })
  is_active: boolean;

  @Column({ type: "varchar", length: 255, nullable: true })
  roles: string;

  @Column({ type: "varchar", length: 50, default: "active" })
  status: string;

  @Column({ type: "varchar", length: 100, nullable: true })
  timezone: string;

  @Column({ type: "varchar", length: 50, nullable: true })
  language: string;

  @Column({ type: "text", nullable: true })
  avatar: string;

  @Column({ type: "datetime", nullable: true })
  last_login_at: Date;

  @Column({ type: "json", nullable: true })
  listing_ids: any;

  @CreateDateColumn({ type: "datetime" })
  created_at: Date;

  @UpdateDateColumn({ type: "datetime" })
  updated_at: Date;
}
