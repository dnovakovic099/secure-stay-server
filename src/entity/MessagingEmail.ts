import { Entity, PrimaryGeneratedColumn, Column } from "typeorm";

@Entity("messaging_email_info")
export class MessagingEmailInfo {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    email: string;

    @Column({ default: true })
    status: boolean;

    @Column()
    created_at: Date;

    @Column()
    updated_at: Date;
}
