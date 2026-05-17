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
import { isCancelledStatus } from '../utils/reservationCancellation.util';
import { ResolutionsTeamSlackService } from '../services/ResolutionsTeamSlackService';

@EventSubscriber()
export class ReservationInfoSubscriber
    implements EntitySubscriberInterface<ReservationInfoEntity> {

    listenTo() {
        return ReservationInfoEntity;
    }

    async afterInsert(event: InsertEvent<ReservationInfoEntity>) {
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
        const { databaseEntity, entity, manager } = event;
        if (!databaseEntity || !entity) return;

        const oldData = { ...databaseEntity };
        const newData = { ...entity };
        const diff = getDiff(oldData, newData);

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

        const previousStatus = (oldData as any).status;
        const nextStatus = (newData as any).status;
        const reservationId = Number((entity as any).id ?? (databaseEntity as any).id);
        if (reservationId && isCancelledStatus(nextStatus) && !isCancelledStatus(previousStatus)) {
            new ResolutionsTeamSlackService()
                .handleLateCancelledReservation(reservationId, new Date())
                .catch((error) => logger.error(`ReservationInfoSubscriber: late cancellation Slack sync failed for reservation ${reservationId}`, error));
        }
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
