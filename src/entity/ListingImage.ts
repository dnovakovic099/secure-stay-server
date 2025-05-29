import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from "typeorm";

import { Listing } from "./Listing";

@Entity("listing_image")
export class ListingImage {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  caption: string;

  @Column({ nullable: true })
  vrboCaption: string;

  @Column({ nullable: true })
  airbnbCaption: string;

  @Column()
  url: string;

  @Column({ nullable: true })
  sortOrder: number;

  @ManyToOne(() => Listing, (listing) => listing.images,{
    onDelete: "CASCADE"
  })
  @JoinColumn({ name: "listing_id" })
  listing: number;
}
