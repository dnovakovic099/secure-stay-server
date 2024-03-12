import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity()
export class AutomatedMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  messageType: string;

  @Column("text")
  smsMessage: string;

  @Column("text")
  emailMessage: string;

  @Column("text")
  airBnbMessage: string;
}
