// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column} from "typeorm";

@Entity("listing_lock_info") // Specify the name of your MySQL table
export class ListingLockInfo {
  @PrimaryGeneratedColumn({ name: "id" })
  id: number;

  @Column()
  listing_id: number;

  @Column()
  lock_id: string;

  @Column({ default: 1, type: "tinyint" })
  status: number;

  @Column()
  created_at: Date;

  @Column()
  updated_at: Date;
}
