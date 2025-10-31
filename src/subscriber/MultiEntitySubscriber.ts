import {
    EventSubscriber,
    EntitySubscriberInterface,
    InsertEvent,
    UpdateEvent,
    RemoveEvent
} from "typeorm";
import { ClientTicket } from "../entity/ClientTicket";

import { activityQueue } from "../queue/fileUploadQueue";
import { RequestContext } from "../utils/RequestContext";
import { ClientEntity } from "../entity/Client";
import { ClientPropertyEntity } from "../entity/ClientProperty";
import { ClientSecondaryContact } from "../entity/ClientSecondaryContact";
import { PropertyOnboarding } from "../entity/PropertyOnboarding";
import { PropertyServiceInfo } from "../entity/PropertyServiceInfo";
import { PropertyInfo } from "../entity/PropertyInfo";
import { PropertyBedTypes } from "../entity/PropertyBedTypes";
import { PropertyBathroomLocation } from "../entity/PropertyBathroomLocation";
import { PropertyParkingInfo } from "../entity/PropertyParkingInfo";
import { PropertyUpsells } from "../entity/PropertyUpsells";
import { PropertyVendorManagement } from "../entity/PropertyVendorManagement";
import { SuppliesToRestock } from "../entity/SuppliesToRestock";
import { VendorInfo } from "../entity/VendorInfo";
import { Resolution } from "../entity/Resolution";
import { ExpenseEntity } from "../entity/Expense";
import { ReservationInfoEntity } from "../entity/ReservationInfo";

@EventSubscriber()
export class MultiEntitySubscriber implements EntitySubscriberInterface {
    private readonly entitiesToListen = [
        ClientTicket, ClientEntity, ClientPropertyEntity, ClientSecondaryContact,
        PropertyOnboarding, PropertyServiceInfo, PropertyInfo, PropertyBedTypes, PropertyBathroomLocation,
        PropertyParkingInfo, PropertyUpsells, PropertyVendorManagement, SuppliesToRestock, VendorInfo, ExpenseEntity, Resolution, ReservationInfoEntity
    ];

    listenTo() {
        return null;
    }

    beforeInsert(event: InsertEvent<any>) {
        if (!this.isListenedEntity(event)) return;
    }

    async afterUpdate(event: UpdateEvent<any>) {
        if (!this.isListenedEntity(event)) return;

        const { databaseEntity, entity } = event;
        if (!databaseEntity || !entity) return;

        const context = RequestContext.get();
        const user = context?.user;

        const ignoredFields = ["updatedAt", "completedOn", "completedBy", "updated_at", "updatedBy", "updated_by"];

        const changedColumns = event.updatedColumns
            .filter(col => !ignoredFields.includes(col.propertyName))
            .map(col => ({
                field: col.propertyName,
                from: event.databaseEntity[col.propertyName],
                to: event.entity[col.propertyName],
            }));

        for (const change of changedColumns) {
            const payload = {
                userId: user?.id,
                userName: user ? `${user.firstName} ${user.lastName}` : "System",
                action: "changed",
                objectType: event.metadata.name.toLowerCase(),
                objectId: event.entity.id,
                objectName: change.field,
                changes: { from: change.from, to: change.to },
                updatedAt: entity.updatedAt,
            };

            await activityQueue.add("log", { payload });
        }

    }

    beforeRemove(event: RemoveEvent<any>) {
        if (!this.isListenedEntity(event)) return;
    }

    private isListenedEntity(event: InsertEvent<any> | UpdateEvent<any> | RemoveEvent<any>) {
        return this.entitiesToListen.includes(event.metadata.target as any);
    }
}
