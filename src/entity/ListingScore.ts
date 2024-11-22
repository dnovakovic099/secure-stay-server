// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("listing_score_info") // Specify the name of your MySQL table
export class ListingScore {
  @PrimaryGeneratedColumn({ name: "id" })
  id: number;

  @Column({ type: "int", nullable: false })
  listingId: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  revenuePotential: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  marketRevenue: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  cleaningFee: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  potentialCleaningFee: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  marketCleaningFee: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  revenueSharing: number;

  @Column({ type: "int", default: 0 })
  photographyScore: number;

  @Column({ type: "text", nullable: true })
  photographyAnalysis: string;

  @Column({ type: "int", default: 0 })
  designScore: number;

  @Column({ type: "text", nullable: true })
  designAnalysis: string;

  @Column({ type: "int", default: 0 })
  amenitiesScore: number;

  @Column({ type: "text", nullable: true })
  amenitiesAnalysis: string;

  @Column({ type: "int", default: 0 })
  sleepingCount: number;

  @Column({ type: "int", default: 0 })
  sleepingCountScore: number;

  @Column({ type: "text", nullable: true })
  sleepingCountAnalysis: string;

  @Column({ type: "int", default: 0 })
  reviewScore: number;

  @Column({ type: "text", nullable: true })
  reviewAnalysis: string;
}
