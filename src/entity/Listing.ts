// Import necessary modules from TypeORM
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
} from "typeorm";
import { ListingImage } from "./ListingImage";

@Entity("listing_info") // Specify the name of your MySQL table
export class Listing {
  @PrimaryGeneratedColumn({ name: "listing_id" })
  listingId: number;

  @Column()
  id: number;

  @Column()
  name: string;

  @Column()
  externalListingName: string;

  @Column()
  address: string;

  @Column("float")
  price: number;

  @Column("int")
  guestsIncluded: number;

  @Column("float")
  priceForExtraPerson: number;

  @Column()
  currencyCode: string;

  @OneToMany(() => ListingImage, (image) => image.listing)
  images: ListingImage[];
}


