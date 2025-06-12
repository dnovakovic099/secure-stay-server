import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity({ name: 'reservation_info_logs' })
export class ReservationInfoLog {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    reservationInfoId: number;

    @Column({ type: 'json', nullable: true })
    oldData: any;

    @Column({ type: 'json', nullable: true })
    newData: any;

    @Column({ type: 'json', nullable: true })
    diff: Record<string, { old: any; new: any; }>;

    @Column()
    changedBy: string;    // e.g. user ID or 'system'

    @CreateDateColumn()
    changedAt: Date;

    @Column({ default: 'UPDATE' })
    action: 'INSERT' | 'UPDATE' | 'DELETE';
}
