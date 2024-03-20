import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity('user_subscription_info')
export class UserSubscriptionInfo {
    @PrimaryGeneratedColumn()
    id: number;

    @Column()
    subscriptionId: string;

    @Column()
    customerId: string;

    @Column()
    planId: string;

    @Column()
    startDate: string;

    @Column()
    endDate: string;

    @Column()
    durationInDays: number;

    @Column()
    userId: string;

    @Column({ default: true })
    status: boolean;

    @Column()
    created_at: Date;

    @Column()
    updated_at: Date;
}