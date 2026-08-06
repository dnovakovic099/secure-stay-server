import {
    Entity,
    PrimaryGeneratedColumn,
    Column,
    CreateDateColumn,
    Index,
} from "typeorm";

/**
 * One daily Editor-optimize run. Stores distilled lessons from yesterday's
 * judged AI misses so the reply Editor prompt stays current without a redeploy.
 */
@Entity("ai_editor_lesson_runs")
export class AIEditorLessonRunEntity {
    @PrimaryGeneratedColumn()
    id: number;

    /** Calendar day in America/New_York that was analyzed (YYYY-MM-DD). */
    @Index({ unique: true })
    @Column({ length: 10 })
    dayEt: string;

    /** Miss rows that fed this run. */
    @Column({ type: "int", default: 0 })
    missCount: number;

    /** JSON: { ignored_ask: n, wrong_info: n, ... } */
    @Column({ type: "text", nullable: true })
    categoryBreakdown: string | null;

    /** One-paragraph human summary of what went wrong yesterday. */
    @Column({ type: "text", nullable: true })
    summary: string | null;

    /**
     * JSON array of lessons:
     * [{ rule, example, category }]
     */
    @Column({ type: "mediumtext", nullable: true })
    lessonsJson: string | null;

    /** Model used for distillation. */
    @Column({ length: 64, nullable: true })
    modelName: string | null;

    @CreateDateColumn({ type: "timestamp" })
    createdAt: Date;
}
