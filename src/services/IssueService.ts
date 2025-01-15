import { Issue } from '../entity/Issue';
import * as XLSX from 'xlsx';
import sendEmail from '../utils/sendEmai';
import { appDatabase } from '../utils/database.util';
import { Request } from 'express';

export class IssueService {

  private issueRepository = appDatabase.getRepository(Issue);

  async findAll(request: Request){
    const page = Number(request.query.page) || 1;
    const limit = Number(request.query.limit) || 10;
    const offset = (page - 1) * limit;

    return await this.issueRepository.find({
      take: limit,
      skip: offset,
      order: {
        id: "DESC",
      },
    });
  }

  async findOne(request: Request): Promise<Issue> {
    const id = Number(request.params.id) ;
    return await this.issueRepository.findOne({ where: { id } });
  }

  async update(request: Request) {
    const id = request.params.id;
    const issueData = request.body;
    await this.issueRepository.update(id, issueData);
    return this.findOne(request);
  }

  async exportIssueToExcel(request: Request): Promise<Buffer> {
    const issues = await this.findAll(request);
    const formattedData = issues?.map(reservation => ({
      status: reservation.status,
      claimResolutionStatus: reservation.claimResolutionStatus,
      claimResolutionAmount: reservation.claimResolutionAmount,
      checkInDate: reservation.checkInDate,
      reservationAmount: reservation.reservationAmount,
      channel: reservation.channel, 
      guestName: reservation.guestName, 
      linkedExpenseId: reservation.linkedExpenseId,
      dateListing: reservation.dateListing,
      issueReportedDateTime: reservation.issueReportedDateTime,
      contractorFirstContactedDateTime: reservation.contractorFirstContactedDateTime,
      contractorDeployedDateTime: reservation.contractorDeployedDateTime,
      quoteAmount1: reservation.quoteAmount1,
      contractorQuote1: reservation.contractorQuote1, 
      quoteAmount2: reservation.quoteAmount2,
      contractorQuote2: reservation.contractorQuote2, 
      quoteAmount3: reservation.quoteAmount3,
      contractorQuote3: reservation.contractorQuote3, 
      researchedEstimatedReasonablePrice: reservation.researchedEstimatedReasonablePrice, 
      finalPrice: reservation.finalPrice, 
      workFinishedDateTime: reservation.workFinishedDateTime,
      finalContractorName: reservation.finalContractorName, 
      reportedBy: reservation.reportedBy, 
      preventable: reservation.preventable,
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const csv = XLSX.utils.sheet_to_csv(worksheet);

    return Buffer.from(csv, 'utf-8');
    }

  async sendEmailForUnresolvedIssues(): Promise<void> {
    const unresolvedIssues = await this.issueRepository.find({
      where: {
        status: 'In Progress',
      },
    });
  
    if (unresolvedIssues.length > 0) {
      const subject = "Action Required: Unresolved Issues";
      const reservationId = "Your reservation ID here";
      const date = new Date().toLocaleDateString();
  
      const html = `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; background-color: #f4f4f9; padding: 20px; color: #333;">
          <div style="max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); padding: 30px; border: 1px solid #ddd;">
            <h2 style="color: #0056b3; font-size: 20px; margin-bottom: 20px; text-align: center; border-bottom: 2px solid #0056b3; padding-bottom: 10px;">
              Notification: Unresolved Issues
            </h2>
            <p style="margin: 20px 0; font-size: 16px; color: #555; text-align: center;">
              A guest has submitted an issue that requires your attention. Please review the details below:
            </p>
            <div style="background-color: #f9f9fc; border-left: 5px solid #0056b3; padding: 15px; margin: 20px 0; border-radius: 6px;">
              <p style="font-size: 18px; color: #333; margin: 0;">
                <strong>Issues:</strong>
              </p>
              <p style="font-size: 20px; color: #000; margin: 10px 0; font-weight: bold;">
                ${unresolvedIssues.map(issue => `
                  <strong>ID:</strong> ${issue.id}, <strong>Status:</strong> ${issue.status}, <strong>Description:</strong> ${issue.issueDescription}<br>
                `).join('')}
              </p>
            </div>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
              <strong>Reservation ID:</strong> ${reservationId}
            </p>
            <p style="margin: 20px 0; font-size: 16px; color: #555;">
              <strong>Received at:</strong> ${date}
            </p>
          </div>
        </body>
        </html>
      `;
  
      await sendEmail(subject, html, process.env.EMAIL_FROM, 'admin@luxurylodgingpm.com');
    }
  }

  async filterIssues(filterParams: any): Promise<Issue[]> {
    const queryBuilder = this.issueRepository.createQueryBuilder('issue');
  
    if (filterParams.listing) {
      queryBuilder.andWhere('issue.listing = :listing', { listing: filterParams.listing });
    }
  
    if (filterParams.claimResolutionStatus !== 'N/A') {
      queryBuilder.andWhere('issue.claimResolutionStatus <> :status', { status: 'N/A' });
    }
  
    if (filterParams.date) {
      queryBuilder.andWhere('issue.checkInDate = :date', { date: filterParams.date });
    }
  
    if (filterParams.homeowner) {
      queryBuilder.andWhere('issue.homeowner = :homeowner', { homeowner: filterParams.homeowner });
    }
  
    if (filterParams.status) {
      queryBuilder.andWhere('issue.status = :status', { status: filterParams.status });
    }
  
    return await queryBuilder.getMany();
  }
  
}
