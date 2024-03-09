import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';


@Entity({ name: 'pm_list' })
export class PmSoftwareEntity {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'varchar', length: 100, nullable: false })
    pmName: string;

    @Column({ type: 'tinyint', default: 1, nullable: false, })
    status: Number;

    @Column({ type: "bool", default: 1, nullable: false })
    isActive: Boolean;

}