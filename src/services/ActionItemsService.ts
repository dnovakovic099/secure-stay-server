import { appDatabase } from "../utils/database.util";
import { ActionItems } from "../entity/ActionItems";

interface ActionItemFilter {
    category?: string;
    page: number;
    limit: number;
}

export class ActionItemsService {
    private actionItemsRepo = appDatabase.getRepository(ActionItems);

    async saveActionItem(actionItem: ActionItems) {
        return await this.actionItemsRepo.save(actionItem);
    }

    async getActionItems(filter: ActionItemFilter) {
        const { category, page, limit } = filter;
        const [actionItems, total] = await this.actionItemsRepo.findAndCount({
            where: category ? { category: category } : {},
            skip: (page - 1) * limit,
            take: limit,
            order: {
                createdAt: 'DESC'
            }
        });

        return {
            actionItems,
            total
        };
    }
}
