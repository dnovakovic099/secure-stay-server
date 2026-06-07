import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { TimeEntryEntity } from './TimeEntry';

@Entity({ name: 'time_entry_breaks' })
export class TimeEntryBreakEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    timeEntryId: number;

    @Column({ type: 'datetime' })
    startBreakAt: Date;

    @Column({ type: 'datetime', nullable: true })
    endBreakAt: Date;

    @Column({ type: 'int', nullable: true })
    duration: number;

    @ManyToOne(() => TimeEntryEntity, entry => entry.breaks, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'timeEntryId' })
    timeEntry: TimeEntryEntity;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
