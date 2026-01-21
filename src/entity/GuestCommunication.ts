import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * GuestCommunication Entity
 * Stores raw communication data from OpenPhone (calls, SMS) and Hostify (messages)
 */
@Entity('guest_communication')
export class GuestCommunicationEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index()
    @Column()
    reservationId: number;

    @Column({ length: 50 })
    source: string;  // 'openphone_call' | 'openphone_sms' | 'hostify_message'

    @Column({ length: 255, nullable: true })
    externalId: string;  // ID from source system

    @Column('text')
    content: string;  // Message body, call transcript, or call summary

    @Column({ length: 20 })
    direction: string;  // 'inbound' | 'outbound'

    @Column({ length: 100, nullable: true })
    senderName: string;

    @Column({ length: 50, nullable: true })
    senderPhone: string;

    @Column({ type: 'datetime' })
    communicatedAt: Date;

    @Column('json', { nullable: true })
    metadata: Record<string, any>;

    @CreateDateColumn()
    createdAt: Date;

    @UpdateDateColumn()
    updatedAt: Date;
}
