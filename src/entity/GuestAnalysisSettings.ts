import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export type GuestAnalysisSettingsSectionKey = "categories" | "departments" | "priorities";
export type GuestAnalysisDerivedStatus = "No issue" | "Monitor" | "Action needed";

export interface GuestAnalysisSettingsEntry {
    id: string;
    name: string;
    shortLabel?: string | null;
    description?: string | null;
    criteria: string;
    sortOrder: number;
    isActive: boolean;
    rank?: number | null;
    statusBucket?: GuestAnalysisDerivedStatus | null;
}

export interface GuestAnalysisSettingsSection {
    key: GuestAnalysisSettingsSectionKey;
    title: string;
    items: GuestAnalysisSettingsEntry[];
}

export interface GuestAnalysisSettingsValue {
    version: number;
    sections: Record<GuestAnalysisSettingsSectionKey, GuestAnalysisSettingsSection>;
}

export interface GuestAnalysisMigrationMapping {
    fromId: string;
    toId: string;
}

export interface GuestAnalysisMigrationPlan {
    categories?: GuestAnalysisMigrationMapping[];
    departments?: GuestAnalysisMigrationMapping[];
    priorities?: GuestAnalysisMigrationMapping[];
}

@Entity("guest_analysis_settings")
export class GuestAnalysisSettingsEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 120, unique: true })
    settingKey: string;

    @Column("json")
    value: GuestAnalysisSettingsValue;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}

@Entity("guest_analysis_settings_audit")
export class GuestAnalysisSettingsAuditEntity {
    @PrimaryGeneratedColumn("uuid")
    id: string;

    @Column({ length: 120 })
    settingKey: string;

    @Column("json")
    previousValue: GuestAnalysisSettingsValue;

    @Column("json")
    nextValue: GuestAnalysisSettingsValue;

    @Column("json", { nullable: true })
    migrationPlan: GuestAnalysisMigrationPlan | null;

    @Column({ length: 120, nullable: true })
    updatedBy: string | null;

    @CreateDateColumn()
    createdAt: Date;
}
