import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class ConnectedAccountInfo {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    account: string;

    @Column({ default: null })
    clientId: string;

    @Column({ default: null })
    clientSecret: string;

    @Column({ default: null })
    apiKey: string;

    @Column()
    userId: string;

    @Column({ default: true })
    status: boolean;

    @Column()
    created_at: Date;

    @Column()
    updated_at: Date;
}