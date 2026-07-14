import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

/**
 * One AI-graded (employee, day) cell for the admin workload page: an estimate
 * of active working minutes plus a quality grade, derived from that day's real
 * Quo calls/texts AND SecureStay activity (inbox replies, AI feedback).
 * Same approach as the standalone quo-team-dashboard grader.
 */
@Entity("admin_workday_grades")
export class AdminWorkdayGradeEntity {
    @PrimaryGeneratedColumn()
    id: number;

    /** Lowercased email — the join key between Quo workspace users and SS users. */
    @Index()
    @Column({ length: 255 })
    userKey: string;

    @Column({ length: 255, nullable: true })
    displayName: string | null;

    @Index()
    @Column({ type: "date" })
    date: string;

    @Column({ length: 60, nullable: true })
    model: string | null;

    @Column({ type: "int", default: 1 })
    version: number;

    /** 0 while the day is still in progress (re-graded next run). */
    @Column({ type: "tinyint", default: 0 })
    complete: number;

    @Column({ type: "int", default: 0 })
    activeMinutes: number;

    @Column({ type: "int", default: 0 })
    callMinutes: number;

    @Column({ type: "int", default: 0 })
    messageMinutes: number;

    /** SecureStay activity portion (inbox replies + AI feedback/teaching). */
    @Column({ type: "int", default: 0 })
    ssMinutes: number;

    @Column({ length: 20, nullable: true })
    workloadGrade: string | null;

    @Column({ length: 2, nullable: true })
    qualityGrade: string | null;

    @Column({ type: "int", nullable: true })
    qualityScore: number | null;

    @Column({ type: "text", nullable: true })
    qualityNotes: string | null;

    @Column({ type: "text", nullable: true })
    summary: string | null;

    /** JSON array of cited moments. */
    @Column({ type: "mediumtext", nullable: true })
    examples: string | null;

    @Column({ type: "int", default: 0 })
    callsCount: number;

    @Column({ type: "int", default: 0 })
    quoMessagesCount: number;

    @Column({ type: "int", default: 0 })
    ssRepliesCount: number;

    @Column({ type: "int", default: 0 })
    ssAiEventsCount: number;

    @Column({ type: "int", default: 0 })
    talkSec: number;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;

    @UpdateDateColumn({ type: "timestamp" })
    updatedAt: Date;
}
