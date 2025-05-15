// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

// Define the entity class
@Entity({ name: 'mobileUsers' })
export class MobileUsersEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'int', nullable: false })
  hostawayId: number;

  @Column({ type: 'varchar', length: 50, nullable: false })
  firstName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  lastName: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  email: string;

  @Column({ type: 'varchar', length: 255, nullable: false })
  password: string;

  @Column({ type: 'int', nullable: true })
  revenueSharing: number;

  @Column({ type: 'varchar', length: 100, nullable: false })
  user_id: string;

  @Column({ nullable: true, default: null })
  referralCode: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  updatedBy: string;

  @Column({ type: 'timestamp', nullable: true })
  lastPasswordChangedAt: Date;

  @Column({ type: 'varchar', length: 100, nullable: true })
  lastPasswordChangedBy: string;
}