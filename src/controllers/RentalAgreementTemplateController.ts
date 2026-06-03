import { Request, Response, NextFunction } from "express";
import { rentalAgreementTemplateService } from "../services/RentalAgreementTemplateService";

interface CustomRequest extends Request {
    user?: any;
}

export class RentalAgreementTemplateController {
    async getAll(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const page = parseInt(req.query.page as string) || 1;
            const limit = parseInt(req.query.limit as string) || 20;
            const result = await rentalAgreementTemplateService.getAll(page, limit);
            res.json({
                success: true,
                data: result.data,
                pagination: { page: result.page, limit: result.limit, total: result.total, totalPages: Math.ceil(result.total / result.limit) },
            });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async getById(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const template = await rentalAgreementTemplateService.getById(Number(req.params.id));
            res.json({ success: true, data: template });
        } catch (err: any) {
            res.status(err.message === "Template not found" ? 404 : 500).json({ success: false, message: err.message });
        }
    }

    async getRules(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const rules = await rentalAgreementTemplateService.getRules();
            res.json({ success: true, data: rules });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async create(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.email || req.user?.id;
            const template = await rentalAgreementTemplateService.create(req.body, userId);
            res.status(201).json({ success: true, data: template });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }

    async update(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.email || req.user?.id;
            const template = await rentalAgreementTemplateService.update(Number(req.params.id), req.body, userId);
            res.json({ success: true, data: template });
        } catch (err: any) {
            res.status(err.message === "Template not found" ? 404 : 500).json({ success: false, message: err.message });
        }
    }

    async delete(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            await rentalAgreementTemplateService.delete(Number(req.params.id));
            res.json({ success: true, message: "Template deactivated" });
        } catch (err: any) {
            res.status(err.message === "Template not found" ? 404 : 500).json({ success: false, message: err.message });
        }
    }

    async createRules(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.email || req.user?.id;
            const rules = await rentalAgreementTemplateService.upsertRules(req.body, userId);
            res.status(201).json({ success: true, data: rules });
        } catch (err: any) {
            res.status(400).json({ success: false, message: err.message });
        }
    }

    async updateRule(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.email || req.user?.id;
            const rule = await rentalAgreementTemplateService.updateRule(Number(req.params.ruleId), req.body, userId);
            res.json({ success: true, data: rule });
        } catch (err: any) {
            res.status(err.message === "Template rule not found" ? 404 : 400).json({ success: false, message: err.message });
        }
    }

    async bulkUpdateRules(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            const userId = req.user?.email || req.user?.id;
            const rules = await rentalAgreementTemplateService.bulkUpdateRules(req.body.ids || [], req.body, userId);
            res.json({ success: true, data: rules });
        } catch (err: any) {
            res.status(400).json({ success: false, message: err.message });
        }
    }

    async deleteRule(req: CustomRequest, res: Response, next: NextFunction) {
        try {
            await rentalAgreementTemplateService.deleteRule(Number(req.params.ruleId));
            res.json({ success: true, message: "Template rule deleted" });
        } catch (err: any) {
            res.status(500).json({ success: false, message: err.message });
        }
    }
}
