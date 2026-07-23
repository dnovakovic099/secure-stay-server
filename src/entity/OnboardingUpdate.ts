import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { ClientPropertyEntity } from "./ClientProperty";

@Entity("onboarding_updates")
export class OnboardingUpdate {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column()
  propertyId: string;

  @Column({ type: "text" })
  message: string;

  @Column({ type: "varchar", length: 20, default: "user" })
  type: "user" | "system";

  @Column({ type: "varchar", length: 80, nullable: true })
  eventType: string | null;

  @Column({ type: "json", nullable: true })
  metadata: Record<string, unknown> | null;

  @Column({ nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: "timestamp" })
  createdAt: Date;

  @ManyToOne(() => ClientPropertyEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "propertyId" })
  property: ClientPropertyEntity;
}
