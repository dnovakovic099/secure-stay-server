import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('messages')
export class Message {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    messageId: number;

    @Column({ nullable: true })
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

    // Hostify-specific fields
    @Column({ nullable: true })
    threadId: string;

    @Column({ nullable: true })
    listingId: string;

    @Column({ nullable: true })
    guestId: string;

    @Column({ default: 'hostaway' })
    source: string;

    @CreateDateColumn({ type: 'timestamp' })
    createdAt: Date;

    @UpdateDateColumn({ type: 'timestamp' })
    updatedAt: Date;
}
