// Import necessary modules from TypeORM
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { ListingImage } from "./ListingImage";
import { ListingBedTypes } from "./ListingBedTypes";
import { ListingAmenities } from "./ListingAmenities";

@Entity("listing_info") // Specify the name of your MySQL table
export class Listing {
  @PrimaryColumn({ type: "bigint" })
  id: number;

  @Column()
  name: string;

  @Column({ type: "text", nullable: true })
  description: string;

  @Column({ default: "(NOT SPECIFIED)" })
  propertyType: string;

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

  @OneToMany(() => ListingImage, (image) => image.listing,{
    cascade: true,
    onDelete: "CASCADE"
  })
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

  @Column({ nullable: true })
  timeZoneName: string;

  @Column()
  wifiUsername: string;

  @Column()
  wifiPassword: string;

  @Column()
  bookingcomPropertyRoomName: string;

  @Column("int")
  guests: number;

  @Column({ nullable: true })
  ownerName: string;

  @Column({ nullable: true })
  ownerEmail: string;

  @Column({ nullable: true })
  ownerPhone: string;

  @Column({ nullable: true })
  propertyTypeId: number;

  @Column({ nullable: true })
  roomType: string;

  @Column({ nullable: true })
  bedroomsNumber: number;

  @Column({ nullable: true })
  bathroomsNumber: number;

  @Column({ nullable: true })
  bathroomType: string;

  @Column({ nullable: true })
  guestBathroomsNumber: number;

  @Column({ nullable: true })
  cleaningFee: number;

  @Column({ nullable: true })
  airbnbPetFeeAmount: number;

  @Column({ nullable: true })
  squareMeters: number;

  @Column({ nullable: true })
  language: string;

  @Column({ nullable: true })
  instantBookable: string;

  @Column({ nullable: true })
  instantBookableLeadTime: number;

  @Column({ nullable: true })
  minNights: number;

  @Column({ nullable: true })
  maxNights: number;

  @Column({ nullable: true })
  contactName: string;

  @Column({ nullable: true })
  contactPhone1: string;

  @Column({ nullable: true })
  contactLanguage: string;

  @Column({ nullable: true })
  propertyLicenseNumber: string;

  @Column({ nullable: true })
  personCapacity: number;

  @OneToMany(() => ListingAmenities, (tags) => tags.listing, {
    cascade: true,
    onDelete: "CASCADE"
  })
  listingAmenities: ListingAmenities[];

  @Column({ nullable: true })
  tags: string;
}
