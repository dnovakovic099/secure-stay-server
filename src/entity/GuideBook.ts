import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Listing } from "./Listing";

@Entity("guidebook")
export class GuideBook {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  title: string;

  @Column({ type: "text" })
  description: string;

  @Column()
  photo: string;

  @ManyToOne(() => Listing, (listing) => listing.guideBook, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "listing_id" })
  listing: number;
}
