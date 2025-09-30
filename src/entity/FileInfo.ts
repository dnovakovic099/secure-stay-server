import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, DeleteDateColumn, UpdateDateColumn } from "typeorm";

@Entity()
export class FileInfo {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ nullable: true })
    localPath: string; // temp file path on server

    @Column({ nullable: true })
    mimetype: string;

    @Column({ nullable: true })
    fileName: string;

    @Column({ nullable: true })
    originalName: string;

    @Column({ nullable: true })
    driveFileId: string;

    @Column({ type: "text", nullable: true })
    webViewLink: string;

    @Column({ type: "text", nullable: true })
    webContentLink: string;

    @Column({ default: "pending" })
    status: "pending" | "uploaded" | "failed";

    @Column({ nullable: true })
    entityType: string;

    @Column({ nullable: true })
    entityId: number;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;

    @DeleteDateColumn({ type: 'timestamp', nullable: true })
    deletedAt: Date;

    @Column({ nullable: true })
    createdBy: string;

    @Column({ nullable: true })
    updatedBy: string;

    @Column({ nullable: true })
    deletedBy: string;
}
