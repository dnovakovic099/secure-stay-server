// Import necessary modules from TypeORM
import {Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn} from 'typeorm';
import {ReservationEntity} from "./Reservation";

// Define the entity class
@Entity({ name: 'payment' })
export class PaymentEntity {
    // Define the primary key column
    @PrimaryGeneratedColumn({ name: 'payment_id' })
    paymentId: number;

    // Define other columns
    @Column({ type: 'float', nullable: true })
    value: number;

    @Column({ type: 'varchar', length: 50, nullable: true })
    currency: string;

    @Column({ type: 'varchar', length: 200, nullable: true })
    name: string;

    @Column({ type: 'date', nullable: true })
    paymentDate: Date;

    @ManyToOne(() => ReservationEntity,{ cascade: true})
    @JoinColumn({ name: 'reservation_id' })
    reservation: ReservationEntity;
}
