import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("action_item_beta_settings")
export class ActionItemBetaSettingEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 120, unique: true })
    settingKey: string;

    @Column("json")
    value: Record<string, any>;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
