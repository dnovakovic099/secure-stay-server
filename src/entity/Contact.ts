import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, DeleteDateColumn, OneToMany } from 'typeorm';
import { ContactUpdates } from './ContactUpdates';

@Entity('contact')
export class Contact {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    status: string;

    @Column()
    listingId: string;

    @Column({ nullable: true })
    role: string;

    @Column()
    name: string;

    @Column({ nullable: true })
    contact: string;

    @Column({ nullable: true })
    email: string;

    @Column({ nullable: true })
    source: string;

    @Column({ type: "text", nullable: true })
    notes: string;

    @Column({ nullable: true })
    website_name: string;

    @Column({ type: 'varchar', length: 2048, nullable: true })
    website_link: string;

    @Column({ nullable: true })
    rate: string;

    @Column({ nullable: true })
    paymentScheduleType: string;

    @Column({ nullable: true })
    paymentIntervalMonth: number;

    @Column({ nullable: true })
    paymentDayOfWeek: string;

    @Column({ nullable: true })
    paymentWeekOfMonth: number;

    @Column({ nullable: true })
    paymentDayOfWeekForMonth: number;

    @Column({ nullable: true })
    paymentDayOfMonth: number;

    @Column({ nullable: true })
    paymentMethod: string;

    @Column({ default: false })
    isAutoPay: boolean;

    @Column({ nullable: true })
    costRating: number;

    @Column({ nullable: true })
    trustLevel: number;

    @Column({ nullable: true })
    speed: number;

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

    @OneToMany(() => ContactUpdates, contact => contact.contact)
    contactUpdates: ContactUpdates[];

    @Column({ nullable: true })
    paidBy: string;
}