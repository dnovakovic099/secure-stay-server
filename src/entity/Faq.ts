import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("faq")
export class FAQ {
  @PrimaryGeneratedColumn({ type: "int" })
  faq_id: number;

  @Column({ type: "varchar", nullable: true })
  faq_question: string;

  @Column({ type: "varchar", nullable: true })
  faq_answer: string;

  @Column({ type: "int", nullable: true })
  listing_id: number;
}
