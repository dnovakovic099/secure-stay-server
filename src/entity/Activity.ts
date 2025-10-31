// src/entities/Activity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from "typeorm";

@Entity()
export class Activity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    user_id: string;

    @Column({ nullable: true })
    user_name: string;

    @Column({ nullable: true })
    action: string; // e.g. "updated", "created", "deleted"

    @Column({ nullable: true })
    object_type: string; // e.g. "Service", "Property"

    @Column({ nullable: true })
    object_id: string;

    @Column({ nullable: true })
    object_name: string;

    @Column({ type: "json", nullable: true })
    changes: any; // { field: "serviceType", from: "Half", to: "Full" }

    @Column({ nullable: true })
    updatedAt: string;

    @CreateDateColumn()
    created_at: Date;
}
