import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("sifely_lock_info")
export class SifelyLock {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lockId: number;

  @Column()
  lockName: string;

  @Column()
  lockAlias: string;

  @Column()
  lockMac: string;

  @Column()
  electricQuantity: number;

  @Column()
  featureValue: string;

  @Column()
  hasGateway: number;

  @Column({ type: "text" })
  lockData: string;

  @Column({ nullable: true })
  groupId: number;

  @Column({ nullable: true })
  groupName: string;

  @Column({ type: "bigint" })
  date: bigint;

  @Column({ default: 1, type: "tinyint" })
  status: number;

  @Column({ type: "text" })
  accessToken: string;

  @Column()
  createdAt: Date;

  @Column()
  updatedAt: Date;
  length: number;
}
