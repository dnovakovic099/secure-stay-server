import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, OneToMany } from 'typeorm';
import { ReservationEntity } from './Reservation';
import { ExpenseEntity } from './Expense';

@Entity('issues')
export class Issue {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  status: 'In Progress' | 'Overdue' | 'Completed' | 'Need Help';

  @Column()
  claimResolutionStatus: 'N/A' | 'Pending' | 'Completed' | 'Denied';

  @Column({ type: 'decimal', nullable: true })
  claimResolutionAmount: number;

  @Column()
  reservationId: string;

  @Column({ type: 'date' })
  checkInDate: Date;

  @Column({ type: 'decimal' })
  reservationAmount: number;

  @Column()
  channel: string; 

  @Column({ nullable: true })
  guestName: string; 

  @Column()
  issueDescription: string;

  @Column({ default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;

  @Column({ default: () => 'CURRENT_TIMESTAMP', onUpdate: 'CURRENT_TIMESTAMP' })
  updatedAt: Date;

  @Column({ nullable: true })
  linkedExpenseId: number;

  @Column({ type: 'date' })
  dateListing: Date;

  @Column({ type: 'timestamp' })
  issueReportedDateTime: Date;

  @Column({ type: 'timestamp' })
  contractorFirstContactedDateTime: Date;

  @Column({ type: 'timestamp' })
  contractorDeployedDateTime: Date;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  quoteAmount1: number;

  @Column({ nullable: true })
  contractorQuote1: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  quoteAmount2: number;

  @Column({ nullable: true })
  contractorQuote2: string;

  @Column('decimal', { precision: 10, scale: 2, nullable: true })
  quoteAmount3: number;

  @Column({ nullable: true })
  contractorQuote3: string;

  @Column({ nullable: true })
  researchedEstimatedReasonablePrice: string;

  @Column({ nullable: true })
  finalPrice: string;

  @Column({ type: 'timestamp', nullable: true })
  workFinishedDateTime: Date;

  @Column({ nullable: true })
  finalContractorName: string;

  @Column({ nullable: true })
  reportedBy: string;

  @Column({ nullable: true })
  preventable: string; // Yes/No

  @Column({ nullable: true })
  notes: string;
   
  @ManyToOne(() => ReservationEntity, reservation => reservation.issues, { eager: true })
  @JoinColumn({ name: 'reservation_id' })
  reservation: ReservationEntity;

  @OneToMany(() => ExpenseEntity, expense => expense.linkedIssue)
  expenses: ExpenseEntity[];
}
