import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("messaging_phone_number_info")
export class MessagingPhoneNoInfo {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    country_code: string;

    @Column()
    phone: string;

    @Column({ default: false })
    supportsSMS: boolean;

    @Column({ default: false })
    supportsCalling: boolean;

    @Column({ default: false })
    supportsWhatsApp: boolean;

    @Column({ default: true })
    status: boolean;

    @Column()
    created_at: Date;

    @Column()
    updated_at: Date;
}
