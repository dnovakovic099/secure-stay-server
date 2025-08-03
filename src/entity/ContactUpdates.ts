import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, DeleteDateColumn } from 'typeorm';
import { Contact } from './Contact';

@Entity('contact_updates')
export class ContactUpdates {
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

    @ManyToOne(() => Contact, contact => contact.contactUpdates, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'actionItemId' })
    contact: Contact;
}