import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('messages')
export class Message {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    messageId: number;

    @Column()
    conversationId: number;

    @Column()
    reservationId: number;

    @Column()
    body: string;

    @Column()
    isIncoming: number;

    @Column()
    receivedAt: Date;

    @Column({ type: 'boolean', default: false })
    answered: boolean;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
