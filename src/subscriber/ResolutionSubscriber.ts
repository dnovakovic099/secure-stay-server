import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
    In,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import { Resolution } from '../entity/Resolution';
import { createExpenseFromResolution, updateExpenseFromResolution } from '../queue/expenseQueue';


@EventSubscriber()
export class ResolutionSubscriber
    implements EntitySubscriberInterface<Resolution> {

    listenTo() {
        return Resolution;
    }


    async afterInsert(event: InsertEvent<Resolution>) {
        const { entity, manager } = event;
        createExpenseFromResolution.add('create-expense', { resolution: entity });
    }

    async afterUpdate(event: UpdateEvent<Resolution>) {
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

        updateExpenseFromResolution.add('update-expense', { resolution: entity });
    }

    async afterRemove(event: RemoveEvent<Resolution>) {
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
    }
}



