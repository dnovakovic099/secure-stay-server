import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity("resolution_categories")
export class ResolutionCategory {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ unique: true })
    categoryKey: string;

    @Column()
    name: string;

    @Column({ type: "int", nullable: true })
    displayOrder: number | null;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
