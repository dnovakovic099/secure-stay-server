import { appDatabase } from '../utils/database.util';
import { RefundRequestSettingsEntity } from '../entity/RefundRequestSettings';

export class RefundRequestSettingsService {
    private repo = appDatabase.getRepository(RefundRequestSettingsEntity);

    async getSettings(): Promise<{ slackTagIds: string | null }> {
        const row = await this.repo.findOne({ where: {}, order: { id: 'ASC' } });
        return row ?? { slackTagIds: null };
    }

    async upsertSettings(slackTagIds: string, userId: string): Promise<RefundRequestSettingsEntity> {
        let row = await this.repo.findOne({ where: {}, order: { id: 'ASC' } });
        if (row) {
            row.slackTagIds = slackTagIds;
            row.updatedBy = userId;
        } else {
            row = this.repo.create({ slackTagIds, createdBy: userId, updatedBy: userId });
        }
        return this.repo.save(row);
    }
}
