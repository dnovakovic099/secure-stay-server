import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, DeleteDateColumn } from 'typeorm';
import { ClientTicketUpdates } from './ClientTicketUpdates';

@Entity('client_ticket')
export class ClientTicket {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column({ nullable: true })
    status: string;

    @Column({ nullable: true })
    listingId: string;

    @Column({ nullable: true })
    category: string;

    @Column({ type: "text", nullable: true })
    description: string;

    @Column({ type: "text", nullable: true })
    resolution: string;

    @Column({ nullable: true })
    completedOn: string;

    @Column({ nullable: true })
    completedBy: string;

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
    
    @OneToMany(() => ClientTicketUpdates, clientTicket => clientTicket.clientTicket)
    clientTicketUpdates: ClientTicketUpdates[];

    @Column({ nullable: true })
    clientSatisfaction: number;

    @Column({ nullable: true })
    assignee: string;

    @Column({ nullable: true })
    urgency: number;

    @Column({ nullable: true })
    mistake: string;

    @Column({ nullable: true })
    mistakeResolvedOn: string;

    @Column({ nullable: true })
    dueDate: string;
}