// src/services/activity.service.ts
import { Activity } from "../entity/Activity";
import { appDatabase } from "../utils/database.util";

export class ActivityService {
    private repo = appDatabase.getRepository(Activity);

    async log({
        userId,
        userName,
        action,
        objectType,
        objectId,
        objectName,
        changes,
        updatedAt,
    }: {
        userId: string;
        userName: string;
        action: string;
        objectType: string;
        objectId?: string;
        objectName?: string;
        changes?: any;
        updatedAt?: string;
    }) {
        const activity = this.repo.create({
            user_id: userId,
            user_name: userName,
            action,
            object_type: objectType,
            object_id: objectId,
            object_name: objectName,
            changes,
            updatedAt,
        });

        await this.repo.save(activity);
    }
}
