import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "typeorm";

@Entity('upsell_orders')
export class UpsellOrder {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    status: string;

    @Column()
    listing_id: string;

    @Column({ nullable: true })
    listing_name: string;

    @Column('decimal', { precision: 10, scale: 2 })
    cost: number;

    @Column({ type: 'date', nullable: true })
    order_date: Date;

    @Column()
    client_name: string;

    @Column()
    property_owner: string;

    @Column()
    type: string;

    @Column('text')
    description: string;

    @Column({ nullable: true })
    booking_id: string;

    @Column({ type: 'date', nullable: true })
    arrival_date: Date;

    @Column({ type: 'date', nullable: true })
    departure_date: Date;

    @Column({ nullable: true })
    phone: string;

    @CreateDateColumn()
    created_at: Date;

    @UpdateDateColumn()
    updated_at: Date;

    @Column({ nullable: true })
    created_by: string;

    @Column({ nullable: true })
    updated_by: string;
} 