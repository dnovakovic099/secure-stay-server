import { NextFunction, Request, Response } from "express";
import { DailySalesReportService } from "../services/DailySalesReportService";
import { appDatabase } from "../utils/database.util";
import { SalesLeadEntity } from "../entity/SalesLead";
import logger from "../utils/logger.utils";

export class DailySalesReportController {
  async runReport(request: Request, response: Response, next: NextFunction) {
    try {
      logger.info("[DailySalesReport] Manual run triggered via API...");
      const service = new DailySalesReportService();
      const result = await service.runDailyReport();
      if (result.skipped === "already_running") {
        return response.status(409).json({
          success: false,
          message: "A daily sales report is already running. Try again in a few minutes.",
          ...result,
        });
      }
      response.status(200).json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  }

  async getLeads(request: Request, response: Response, next: NextFunction) {
    try {
      const { category, status, days } = request.query;
      const repo = appDatabase.getRepository(SalesLeadEntity);
      const qb = repo
        .createQueryBuilder("lead")
        .orderBy("lead.createdAt", "DESC")
        .limit(200);

      if (category) qb.andWhere("lead.category = :category", { category });
      if (status) {
        qb.andWhere("lead.status = :status", { status });
      } else {
        // Suppression records (traced, no contact info found) are bookkeeping,
        // not leads — hide them unless explicitly requested via ?status=no_contact.
        qb.andWhere("lead.status != 'no_contact'");
      }
      const windowDays = Number(days) || 30;
      qb.andWhere("lead.createdAt > DATE_SUB(NOW(), INTERVAL :days DAY)", { days: windowDays });

      const leads = await qb.getMany();
      response.status(200).json({ success: true, leads });
    } catch (error) {
      next(error);
    }
  }

  async updateLeadStatus(request: Request, response: Response, next: NextFunction) {
    try {
      const leadId = Number(request.params.lead_id);
      const { status } = request.body;
      const allowed = ["new", "contacted", "interested", "dead", "won"];
      if (!allowed.includes(status)) {
        return response.status(400).json({ success: false, message: `status must be one of ${allowed.join(", ")}` });
      }
      const repo = appDatabase.getRepository(SalesLeadEntity);
      const lead = await repo.findOne({ where: { id: leadId } });
      if (!lead) {
        return response.status(404).json({ success: false, message: "Lead not found" });
      }
      lead.status = status;
      await repo.save(lead);
      response.status(200).json({ success: true, lead });
    } catch (error) {
      next(error);
    }
  }
}
