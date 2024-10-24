import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'user_api_key' })
export class UserApiKeyEntity {
    @PrimaryGeneratedColumn()
    id: Number;

    @Column({ type: 'varchar', length: 255, nullable: false })
    userId: String;

    @Column({ type: 'varchar', length: 255, nullable: false })
    apiKey: String;

    @Column({ type: "bool", default: 1, nullable: false })
    isActive: Boolean;
}