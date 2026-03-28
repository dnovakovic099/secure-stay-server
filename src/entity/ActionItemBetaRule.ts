import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("action_item_beta_rules")
export class ActionItemBetaRuleEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 140 })
    name: string;

    @Column("text", { nullable: true })
    description: string | null;

    @Column({ length: 36, nullable: true })
    categoryId: string | null;

    @Column({ length: 120, nullable: true })
    categoryName: string | null;

    @Column({ length: 20, default: "Medium" })
    priority: string;

    @Column({ length: 20, default: "medium" })
    sensitivity: string;

    @Column({ type: "float", default: 0.85 })
    autoCreateThreshold: number;

    @Column({ type: "float", default: 0.65 })
    reviewThreshold: number;

    @Column({ default: true })
    enabled: boolean;

    @Column({ default: false })
    builtIn: boolean;

    @Column("json", { nullable: true })
    triggerPhrases: string[] | null;

    @Column("json", { nullable: true })
    excludePhrases: string[] | null;

    @Column("json", { nullable: true })
    examples: string[] | null;

    @Column("json", { nullable: true })
    negativeExamples: string[] | null;

    @Column("text", { nullable: true })
    instructions: string | null;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
