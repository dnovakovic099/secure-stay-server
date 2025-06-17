import {
    EntitySubscriberInterface,
    EventSubscriber,
    UpdateEvent,
    InsertEvent,
    RemoveEvent,
} from 'typeorm';
import { getDiff } from '../helpers/helpers';
import { ReservationInfoEntity } from '../entity/ReservationInfo';
import { ReservationInfoLog } from '../entity/ReservationInfologs';
import logger from '../utils/logger.utils';

@EventSubscriber()
export class ReservationInfoSubscriber
    implements EntitySubscriberInterface<ReservationInfoEntity> {

    listenTo() {
        return ReservationInfoEntity;
    }

    async afterInsert(event: InsertEvent<ReservationInfoEntity>) {
        logger.info(`ReservationInfoSubscriber: afterInsert called for entity ID ${event.entity.id}`);
        const { entity, manager } = event;
        const log = manager.create(ReservationInfoLog, {
            reservationInfoId: entity.id,
            oldData: null,
            newData: entity,
            diff: Object.keys(entity).reduce((acc, key) => {
                acc[key] = { old: null, new: (entity as any)[key] };
                return acc;
            }, {} as any),
            changedBy: 'system',
            action: 'INSERT',
        });
        await manager.save(log);
    }

    async afterUpdate(event: UpdateEvent<ReservationInfoEntity>) {
        logger.info(`ReservationInfoSubscriber: afterUpdate called for entity ID ${event.entity.id}`);
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

        // nothing changed?
        if (Object.keys(diff).length === 0) return;

        const log = manager.create(ReservationInfoLog, {
            reservationInfoId: entity.id,
            oldData,
            newData,
            diff,
            changedBy: 'system',
            action: 'UPDATE',
        });
        await manager.save(log);
    }

    async afterRemove(event: RemoveEvent<ReservationInfoEntity>) {
        logger.info(`ReservationInfoSubscriber: afterRemove called for entity ID ${event.databaseEntity.id}`);
        const { databaseEntity, manager } = event;
        if (!databaseEntity) return;

        const oldData = { ...databaseEntity };
        const log = manager.create(ReservationInfoLog, {
            reservationInfoId: oldData.id,
            oldData,
            newData: null,
            diff: Object.keys(oldData).reduce((acc, key) => {
                acc[key] = { old: (oldData as any)[key], new: null };
                return acc;
            }, {} as any),
            changedBy: 'system',
            action: 'DELETE',
        });
        await manager.save(log);
    }
}
