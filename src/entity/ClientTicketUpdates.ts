import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, DeleteDateColumn } from 'typeorm';
import { ClientTicket } from './ClientTicket';

@Entity('client_ticket_updates')
export class ClientTicketUpdates {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ type: "text", nullable: true })
    updates: string;

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

    @ManyToOne(() => ClientTicket, clientTicket => clientTicket.clientTicketUpdates, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'clientTicketId' })
    clientTicket: ClientTicket;
}