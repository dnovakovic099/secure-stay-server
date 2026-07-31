import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { SmartLockDevice } from "./SmartLockDevice";
import { Listing } from "./Listing";

@Entity("property_devices")
export class PropertyDevice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: "property_id" })
  propertyId: number;

  @Column({ name: "device_id" })
  deviceId: number;

  @Column({ name: "location_label", nullable: true })
  locationLabel: string;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  /** Service doors (electrical rooms, supply closets) never receive guest codes. */
  @Column({ name: "is_guest_door", default: true })
  isGuestDoor: boolean;

  /** unverified | evidence_matched | confirmed — see the verification migration. */
  @Column({ name: "verification_status", default: "unverified" })
  verificationStatus: string;

  @Column({ name: "verification_note", type: "text", nullable: true })
  verificationNote: string | null;

  @Column({ name: "confirmed_by", nullable: true })
  confirmedBy: string | null;

  @Column({ name: "confirmed_at", type: "timestamp", nullable: true })
  confirmedAt: Date | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @ManyToOne(() => SmartLockDevice, (device) => device.propertyDevices)
  @JoinColumn({ name: "device_id" })
  device: SmartLockDevice;

  @ManyToOne(() => Listing)
  @JoinColumn({ name: "property_id" })
  property: Listing;
}
