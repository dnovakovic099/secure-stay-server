import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("action_item_beta_categories")
export class ActionItemBetaCategoryEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 120, unique: true })
    name: string;

    @Column("text", { nullable: true })
    description: string | null;

    @Column({ length: 40, nullable: true })
    color: string | null;

    @Column({ length: 60, nullable: true })
    icon: string | null;

    @Column("text", { nullable: true })
    iconImage: string | null;

    @Column("json", { nullable: true })
    notificationTargets: string[] | null;

    @Column({ default: false })
    isDefault: boolean;

    @Column({ default: true })
    isActive: boolean;

    @Column({ type: "int", default: 0 })
    sortOrder: number;

    @Column({ length: 120, nullable: true })
    createdBy: string | null;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
