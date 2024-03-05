import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity()
export class AutomatedMessage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  messageType: string;

  @Column("text")
  messageText: string;
}
