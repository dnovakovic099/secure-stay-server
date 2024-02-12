// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Define the entity class
@Entity({ name: 'user_verification' })
export class UserVerificationEntity {
    // Define the primary key column
    @PrimaryGeneratedColumn({ name: 'user_verification_id' })
    userVerificationId: number;

    // Define other columns
    @Column({ type: 'varchar', length: 50, nullable: true })
    firstName: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    lastName: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    email: string;

    @Column({ type: 'varchar', length: 50, nullable: true })
    photo: string;

    @Column({ type: 'int', default: 0 })
    approved: number;
}
