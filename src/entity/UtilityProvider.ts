import { Column, CreateDateColumn, DeleteDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("utility_provider")
export class UtilityProvider {
    @PrimaryGeneratedColumn({ type: "int" })
    id: number;

    @Column({ type: "varchar", length: 100 })
    providerType: string;

    @Column({ type: "varchar", length: 150, nullable: true })
    customProviderLabel: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    providerName: string | null;

    @Column({ type: "varchar", length: 255, nullable: true })
    username: string | null;

    @Column({ type: "text", nullable: true })
    password: string | null;

    @Column({ type: "text", nullable: true })
    notes: string | null;

    @Column({ type: "simple-json", nullable: true })
    propertyIds: number[];

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;

    @DeleteDateColumn({ type: "timestamp", nullable: true })
    deletedAt: Date | null;

    @Column({ nullable: true })
    createdBy: string | null;

    @Column({ nullable: true })
    updatedBy: string | null;

    @Column({ nullable: true })
    deletedBy: string | null;
}
