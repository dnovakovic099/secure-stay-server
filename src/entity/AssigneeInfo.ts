import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('assignee_info')
export class AssigneeEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    assigneeName: string;
}