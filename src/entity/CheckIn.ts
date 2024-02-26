import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("checkin")
export class CheckIn {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  stepOrder: number;

  @Column()
  image: string;

  @Column("text")
  description: string;

  @Column({ nullable: true })
  pin: number | null;

  @Column()
  doesHavePin: boolean;

  @Column({ nullable: true })
  pinAdditionalInfo: string | null;

  @Column({ type: "int", nullable: true })
  listing_id: number;
}
