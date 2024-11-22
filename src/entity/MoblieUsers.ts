// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

// Define the entity class
@Entity({ name: 'mobileUsers' })
export class MobileUsersEntity {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'int', nullable: false })
  hostawayId: number;


  @Column({ type: 'varchar', length: 50, nullable: false })
  firstName: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  lastName: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  email: string;

  @Column({ type: 'varchar', length: 100, nullable: false })
  password: string;

}