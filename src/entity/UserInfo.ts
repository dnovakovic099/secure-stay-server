// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

// Define the entity class
@Entity({ name: "users_info" })
export class UsersInfoEntity {
  //define the primary key
  @PrimaryGeneratedColumn({ name: "user_id" })
  userId: Number;

  @Column({ type: "varchar", length: 50, nullable: false })
  fullName: String;

  @Column({ type: "varchar", length: 100, nullable: false })
  email: String;

  @Column({ type: "bigint", nullable: true })
  contact: Number;

  @Column({ type: "varchar", length: 10, nullable: true })
  dialCode: String;

  @Column({ type: "varchar", length: 50, nullable: false })
  userType: String;

  @Column({ type: "varchar", length: 200, nullable: true })
  image: String;

  @Column({ type: "tinyint", default: 1, nullable: false })
  status: Number;

  @Column({ type: "bool", default: 1, nullable: false })
  isActive: Boolean;
}
