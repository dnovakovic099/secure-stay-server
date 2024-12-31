import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

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
}
