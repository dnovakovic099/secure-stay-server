import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity("city_state_info")
export class CityStateInfo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 255 })
  city: string;

  @Index("idx_city_state_info_state_id")
  @Column({ length: 255 })
  state_id: string;

  @Index("idx_city_state_info_state_name")
  @Column({ length: 255 })
  state_name: string;

  @Column({ length: 255 })
  lat: string;

  @Column({ length: 255 })
  lng: string;

  @CreateDateColumn({ type: "datetime" })
  createdAt: Date;

  @UpdateDateColumn({ type: "datetime" })
  updatedAt: Date;
}
