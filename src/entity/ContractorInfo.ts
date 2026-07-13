import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('contractor_info')
export class ContractorEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    contractorName: string;

    @Column({ nullable: true })
    contractorNumber: string;

    @Column({ type: 'int', nullable: true })
    vendorProfileId: number | null;
}
