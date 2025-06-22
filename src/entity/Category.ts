import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('category')
export class CategoryEntity {
    @PrimaryGeneratedColumn({ type: 'int' })
    id: number;

    @Column()
    categoryName: string;

    @Column({nullable:true})
    hostawayId: number;
}