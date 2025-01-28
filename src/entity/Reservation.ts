// Import necessary modules from TypeORM
import {Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany} from 'typeorm';
import {ReservationInfoEntity} from "./ReservationInfo";
import {UserVerificationEntity} from "./UserVerification";
import {PaymentEntity} from "./Payment";

// Define the entity class
@Entity({ name: 'reservation' })
export class ReservationEntity {
    // Define the primary key column
    @PrimaryGeneratedColumn({ name: 'reservation_id' })
    reservationId: number;

    @Column({ type: 'varchar', length: 50, nullable: true })
    reservationLink: string;

    @Column({ type: 'int', nullable: true })
    checkedIn: number;

    @Column({ type: 'int', nullable: true })
    earlyCheckIn: number;

    // Define foreign key relationships
    @ManyToOne(() => ReservationInfoEntity, { eager: true })
    @JoinColumn({ name: 'reservation_info_fk' })
    reservationInfo: ReservationInfoEntity;

    @ManyToOne(() => UserVerificationEntity, { eager: true })
    @JoinColumn({ name: 'user_verification_fk' })
    userVerification: UserVerificationEntity;

    @OneToMany(() => PaymentEntity, payment => payment.reservation,{ eager:true })
    @JoinColumn({ name: 'reservation_fk' })
    payments: PaymentEntity[];
}
