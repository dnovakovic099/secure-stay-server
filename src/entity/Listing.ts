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

  @Column()
  internalListingName: string;

  @Column()
  country: string;
  
  @Column()
  countryCode: string;
  
  @Column()
  state: string;
  
  @Column()
  city: string;
  
  @Column()
  street: string;
  
  @Column()
  zipcode: string;
  
  @Column("float")
  lat: number;

  @Column("float")
  lng: number;
  
  @Column("int")
  checkInTimeStart: number;
  
  @Column("int")
  checkInTimeEnd: number;

  @Column("int")
  checkOutTime: number;

  @Column()
  wifiUsername: string;
  
  @Column()
  wifiPassword: string;
  
  @Column()
  bookingcomPropertyRoomName: string;

}


