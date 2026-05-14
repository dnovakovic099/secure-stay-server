import { EntityManager, In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { ReservationInfoLog } from "../entity/ReservationInfologs";
import { UsersEntity } from "../entity/Users";
import { supabaseAdmin } from "../utils/supabase";

export type ReservationHistoryDiff = Record<string, { old: any; new: any }>;

export class ReservationHistoryService {
  private reservationInfoLogsRepo = appDatabase.getRepository(ReservationInfoLog);
  private usersRepo = appDatabase.getRepository(UsersEntity);

  async logChanges(params: {
    reservationInfoId: number;
    diff: ReservationHistoryDiff;
    changedBy?: string | null;
    action?: "INSERT" | "UPDATE" | "DELETE";
    manager?: EntityManager;
  }) {
    const { reservationInfoId, diff, changedBy, action = "UPDATE", manager } = params;
    const diffEntries = Object.entries(diff).filter(
      ([, value]) => !this.valuesEqual(value?.old, value?.new)
    );

    if (!diffEntries.length) {
      return null;
    }

    const repo = manager ? manager.getRepository(ReservationInfoLog) : this.reservationInfoLogsRepo;
    const oldData = diffEntries.reduce<Record<string, any>>((acc, [field, value]) => {
      acc[field] = value.old ?? null;
      return acc;
    }, {});
    const newData = diffEntries.reduce<Record<string, any>>((acc, [field, value]) => {
      acc[field] = value.new ?? null;
      return acc;
    }, {});

    const log = repo.create({
      reservationInfoId,
      oldData,
      newData,
      diff: Object.fromEntries(diffEntries),
      changedBy: changedBy || "system",
      action,
    });

    return repo.save(log);
  }

  async getLatestUpdatesForReservations(reservationInfoIds: number[]) {
    if (!reservationInfoIds.length) {
      return new Map<number, { changedAt: Date; changedBy: string }>();
    }

    const logs = await this.reservationInfoLogsRepo.find({
      where: {
        reservationInfoId: In(reservationInfoIds),
        action: "UPDATE" as any,
      },
      order: {
        changedAt: "DESC",
        id: "DESC",
      },
    });

    const latestByReservation = new Map<number, { changedAt: Date; changedBy: string }>();
    for (const log of logs) {
      if (!latestByReservation.has(log.reservationInfoId)) {
        latestByReservation.set(log.reservationInfoId, {
          changedAt: log.changedAt,
          changedBy: log.changedBy,
        });
      }
    }

    return latestByReservation;
  }

  async getReservationHistory(reservationInfoId: number) {
    const logs = await this.reservationInfoLogsRepo.find({
      where: { reservationInfoId },
      order: { changedAt: "DESC", id: "DESC" },
    });

    const userIds = Array.from(
      new Set(
        logs
          .map((log) => log.changedBy)
          .filter((value): value is string => Boolean(value) && value !== "system")
      )
    );

    const users = userIds.length
      ? await this.usersRepo.find({ where: { uid: In(userIds) } })
      : [];
    const userMap = new Map(users.map((user) => [
      user.uid,
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || user.uid,
    ]));
    const displayNameCache = new Map<string, string>();

    const resolveDisplayName = async (changedBy?: string | null) => {
      const raw = String(changedBy || "").trim();
      if (!raw) return "Unknown";
      if (raw === "system") return "System";
      if (displayNameCache.has(raw)) return displayNameCache.get(raw) || raw;

      const localName = userMap.get(raw);
      if (localName) {
        displayNameCache.set(raw, localName);
        return localName;
      }

      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(raw);
        if (!error && data?.user) {
          const metadata = data.user.user_metadata || {};
          const fullName = String(metadata.full_name || metadata.name || "").trim();
          const firstName = String(metadata.first_name || metadata.firstName || "").trim();
          const lastName = String(metadata.last_name || metadata.lastName || "").trim();
          const authName = fullName || [firstName, lastName].filter(Boolean).join(" ").trim() || data.user.email || raw;
          displayNameCache.set(raw, authName);
          return authName;
        }
      } catch {
        // Fall through to the stored actor ID if auth metadata cannot be read.
      }

      displayNameCache.set(raw, raw);
      return raw;
    };

    return Promise.all(logs.map(async (log) => ({
      id: log.id,
      reservationInfoId: log.reservationInfoId,
      action: log.action,
      changedAt: log.changedAt,
      changedBy: log.changedBy,
      changedByName: await resolveDisplayName(log.changedBy),
      changes: Object.entries(log.diff || {}).map(([field, value]) => ({
        field,
        oldValue: value?.old ?? null,
        newValue: value?.new ?? null,
      })),
    })));
  }

  private valuesEqual(left: any, right: any) {
    if (left === right) return true;
    return JSON.stringify(left) === JSON.stringify(right);
  }
}
