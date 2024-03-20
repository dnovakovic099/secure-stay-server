import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('user_subscription_checkout_session')
export class UserSubscriptionCheckoutSession {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    sessionId: string;

    @Column()
    userId: string;

    @Column()
    created_at: Date;

    @Column()
    updated_at: Date;
}