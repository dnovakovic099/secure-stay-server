// Import necessary modules from TypeORM
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('item') // Specify the name of your MySQL table
export class Item {
    @PrimaryGeneratedColumn({ type: 'int' })
    item_id: number;

    @Column({ type: 'varchar', nullable: true })
    item_name: string;

    @Column({ type: 'varchar', nullable: true })
    item_description: string;

    @Column({ type: 'float', nullable: true })
    item_price: number;

    @Column({ type: 'int', nullable: true })
    listing_id: number;

    @Column({ type: 'varchar', nullable: true })
    currency: string;

    @Column({ type: 'varchar', nullable: true })
    photo_url: string;
}