import { appDatabase } from "../utils/database.util";
import { Issue } from "../entity/Issue";
import { Between } from "typeorm";

export class IssuesService {
    private issueRepo = appDatabase.getRepository(Issue);

    async createIssue(data: Partial<Issue>) {
        const issue = this.issueRepo.create(data);
        const savedIssue = await this.issueRepo.save(issue);
        return savedIssue;
    }

    async getIssues(page: number = 1, limit: number = 10, fromDate: string = '', toDate: string = '', status: string = '', listing_id: string = '') {

        const queryOptions: any = {
            order: { created_at: 'DESC' },
            skip: (page - 1) * limit,
            take: limit
        };

        if (fromDate && toDate) {
            queryOptions.where = {
                created_at: Between(
                    new Date(fromDate),
                    new Date(toDate)
                )
            };
        }

        if (status) {
            queryOptions.where.status = status;
        }   

        if (listing_id) {
            queryOptions.where.listing_id = listing_id;
        }

        const [issues, total] = await this.issueRepo.findAndCount(queryOptions);

        return {
            data: issues,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit)
            }
        };
    }

    async updateIssue(id: number, data: Partial<Issue>) {
        await this.issueRepo.update(id, data);
        return await this.issueRepo.findOne({ where: { id } });
    }

    async deleteIssue(id: number) {
        return await this.issueRepo.delete(id);
    }

    async getUpsells(fromDate: string, toDate: string, listingId: number) {
        return await this.issueRepo.find({
            where: {
                listing_id: String(listingId),
                created_at: Between(
                    new Date(fromDate),
                    new Date(toDate)
                )
            }
        });
    }
} 