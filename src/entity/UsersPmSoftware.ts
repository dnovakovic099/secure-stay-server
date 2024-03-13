
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';



@Entity({ name: 'user_pm_software_info' })
export class UsersPmSoftwareEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', nullable: false })
    uid: string;

    @Column({ type: 'varchar', nullable: false })
    pmName: string;

    @Column({ type: 'int', nullable: false })
    pmId: Number;

    @Column({ type: "bool", default: 1, nullable: false })
    isActive: number;

    @Column({ type: "bool", default: 1, nullable: false })
    status: number;

}