import { Between, In } from "typeorm";
import { appDatabase } from "../utils/database.util";
import { Employee } from "../entity/Employee";
import { EmployeeScheduleEntry, EmployeeScheduleShiftType } from "../entity/EmployeeScheduleEntry";

const REPORT_TIME_ZONE = "America/New_York";

type ParsedEmployeeSchedule = {
    days?: number[];
    constantStart?: string;
    constantEnd?: string;
    overrides?: Record<string, { start?: string; end?: string }>;
    effectiveStartDate?: string;
};

/**
 * Shared "is this employee on shift at time T?" using the Employees Schedule tab:
 * date overrides → approved leave → recurring schedule JSON (America/New_York).
 */
export class EmployeeShiftService {
    /** Minute-bucket cache — Admin Insights scans thousands of timestamps. */
    private nyPartsCache = new Map<
        number,
        { dateKey: string; dayOfWeek: number; minutes: number }
    >();

    private getNewYorkParts(date: Date) {
        const key = Math.floor(date.getTime() / 60000);
        const cached = this.nyPartsCache.get(key);
        if (cached) return cached;

        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: REPORT_TIME_ZONE,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            weekday: "short",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
        }).formatToParts(date);
        const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
        const weekdayMap: Record<string, number> = {
            Sun: 0,
            Mon: 1,
            Tue: 2,
            Wed: 3,
            Thu: 4,
            Fri: 5,
            Sat: 6,
        };
        const hour = Number(get("hour") || 0);
        const minute = Number(get("minute") || 0);
        const value = {
            dateKey: `${get("year")}-${get("month")}-${get("day")}`,
            dayOfWeek: weekdayMap[get("weekday")] ?? 0,
            minutes: hour * 60 + minute,
        };
        this.nyPartsCache.set(key, value);
        return value;
    }

    /** Fast batch helper: which userIds were on shift at `at`. */
    onShiftUserIdsAt(
        at: Date,
        byUserId: Map<number, Employee>,
        overridesByEmployeeDate: Map<string, EmployeeScheduleEntry>,
        leaveByUserId: Map<number, Array<{ startDate: string; endDate: string }>>
    ): number[] {
        const out: number[] = [];
        for (const [uid, emp] of byUserId) {
            if (this.isEmployeeOnShiftAt(emp, at, overridesByEmployeeDate, leaveByUserId)) {
                out.push(uid);
            }
        }
        return out;
    }

    private addDaysToDateKey(dateKey: string, days: number) {
        const [year, month, day] = dateKey.split("-").map(Number);
        const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
        date.setUTCDate(date.getUTCDate() + days);
        return date.toISOString().slice(0, 10);
    }

    private getDayOfWeekFromDateKey(dateKey: string) {
        const [year, month, day] = dateKey.split("-").map(Number);
        return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay();
    }

    private parseTimeToMinutes(time?: string | null) {
        if (!time) return null;
        const match = String(time).trim().match(/^(\d{1,2})(?::(\d{2}))?/);
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2] || 0);
        if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
        return hours * 60 + minutes;
    }

    private parseSchedule(schedule?: string | null): ParsedEmployeeSchedule | null {
        if (!schedule) return null;
        try {
            const parsed = JSON.parse(schedule);
            return Array.isArray(parsed?.days) ? parsed : null;
        } catch {
            return null;
        }
    }

    private getDateKeyFromDbDate(value: any) {
        if (!value) return "";
        if (value instanceof Date) return value.toISOString().slice(0, 10);
        return String(value).slice(0, 10);
    }

    private toDateOrNull(value: any): Date | null {
        if (!value) return null;
        const parsed = value instanceof Date ? value : new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    private buildOverrideDate(override: EmployeeScheduleEntry, edge: "start" | "end") {
        const explicit = edge === "start" ? override.shiftStartAt : override.shiftEndAt;
        if (explicit) return this.toDateOrNull(explicit);
        const time = edge === "start" ? override.shiftStart : override.shiftEnd;
        const date = this.toDateOrNull(`${this.getDateKeyFromDbDate(override.date)}T${time || "00:00:00"}`);
        if (
            edge === "end" &&
            date &&
            override.shiftStart &&
            override.shiftEnd &&
            override.shiftEnd <= override.shiftStart
        ) {
            date.setDate(date.getDate() + 1);
        }
        return date;
    }

    private isOnApprovedLeave(
        employee: Employee,
        dateKey: string,
        leaveByUserId: Map<number, Array<{ startDate: string; endDate: string }>>
    ) {
        const leaves = leaveByUserId.get(employee.userId) || [];
        return leaves.some((leave) => leave.startDate <= dateKey && leave.endDate >= dateKey);
    }

    isEmployeeOnShiftAt(
        employee: Employee,
        at: Date,
        overridesByEmployeeDate: Map<string, EmployeeScheduleEntry>,
        leaveByUserId: Map<number, Array<{ startDate: string; endDate: string }>>
    ): boolean {
        const current = this.getNewYorkParts(at);
        const candidateDateKeys = [current.dateKey, this.addDaysToDateKey(current.dateKey, -1)];

        for (const candidateDateKey of candidateDateKeys) {
            if (this.isOnApprovedLeave(employee, candidateDateKey, leaveByUserId)) continue;

            const override = overridesByEmployeeDate.get(`${employee.id}-${candidateDateKey}`);
            if (override) {
                if (override.shiftType !== EmployeeScheduleShiftType.REGULAR) continue;
                const start = this.buildOverrideDate(override, "start");
                const end = this.buildOverrideDate(override, "end");
                if (start && end && at.getTime() >= start.getTime() && at.getTime() < end.getTime()) {
                    return true;
                }
                continue;
            }

            const schedule = this.parseSchedule(employee.schedule);
            if (!schedule) continue;
            if (schedule.effectiveStartDate && candidateDateKey < schedule.effectiveStartDate) continue;

            const dayOfWeek = this.getDayOfWeekFromDateKey(candidateDateKey);
            const days = (schedule.days || []).map(Number);
            if (!days.includes(dayOfWeek)) continue;

            const dayOverride =
                schedule.overrides?.[String(dayOfWeek)] || schedule.overrides?.[dayOfWeek as any];
            const startMinutes = this.parseTimeToMinutes(dayOverride?.start || schedule.constantStart);
            const endMinutes = this.parseTimeToMinutes(dayOverride?.end || schedule.constantEnd);
            if (startMinutes === null || endMinutes === null) continue;

            const endAdjusted = endMinutes <= startMinutes ? endMinutes + 1440 : endMinutes;
            const dayOffset = candidateDateKey === current.dateKey ? 0 : 1;
            const minutesFromShiftDate = dayOffset * 1440 + current.minutes;
            if (minutesFromShiftDate >= startMinutes && minutesFromShiftDate < endAdjusted) return true;
        }

        return false;
    }

    async loadShiftContext(start: Date, end: Date): Promise<{
        employees: Employee[];
        byUserId: Map<number, Employee>;
        overridesByEmployeeDate: Map<string, EmployeeScheduleEntry>;
        leaveByUserId: Map<number, Array<{ startDate: string; endDate: string }>>;
        timezone: string;
    }> {
        const employeeRepo = appDatabase.getRepository(Employee);
        const { EmployeeDepartment } = await import("../entity/Employee");
        const employees = await employeeRepo.find({
            where: { isActive: true, department: EmployeeDepartment.GUEST_RELATIONS } as any,
            relations: ["user"],
        });
        const withUser = employees.filter((e) => e.userId != null && Number(e.userId) > 0);
        const byUserId = new Map<number, Employee>();
        for (const e of withUser) byUserId.set(Number(e.userId), e);

        const startKey = start.toISOString().slice(0, 10);
        const endKey = end.toISOString().slice(0, 10);
        // Pad one day for overnight shifts / ET boundary.
        const padStart = this.addDaysToDateKey(startKey, -1);
        const padEnd = this.addDaysToDateKey(endKey, 1);

        const overrideRepo = appDatabase.getRepository(EmployeeScheduleEntry);
        const overrides = withUser.length
            ? await overrideRepo.find({
                  where: {
                      employeeId: In(withUser.map((e) => e.id)),
                      date: Between(padStart as any, padEnd as any),
                  },
              })
            : [];
        const overridesByEmployeeDate = new Map<string, EmployeeScheduleEntry>();
        for (const o of overrides) {
            overridesByEmployeeDate.set(`${o.employeeId}-${this.getDateKeyFromDbDate(o.date)}`, o);
        }

        const leaveByUserId = new Map<number, Array<{ startDate: string; endDate: string }>>();
        try {
            const { LeaveRequestEntity } = await import("../entity/LeaveRequest");
            const userIds = withUser.map((e) => Number(e.userId));
            if (userIds.length) {
                const leaves = await appDatabase
                    .getRepository(LeaveRequestEntity)
                    .createQueryBuilder("leave")
                    .where("leave.deletedAt IS NULL")
                    .andWhere("leave.status IN (:...statuses)", {
                        statuses: ["approved", "cancellation_pending"],
                    })
                    .andWhere("leave.userId IN (:...userIds)", { userIds })
                    .andWhere("leave.endDate >= :padStart", { padStart })
                    .andWhere("leave.startDate <= :padEnd", { padEnd })
                    .getMany();
                for (const row of leaves) {
                    const uid = Number(row.userId);
                    if (!leaveByUserId.has(uid)) leaveByUserId.set(uid, []);
                    leaveByUserId.get(uid)!.push({
                        startDate: this.getDateKeyFromDbDate(row.startDate),
                        endDate: this.getDateKeyFromDbDate(row.endDate),
                    });
                }
            }
        } catch {
            /* leave table optional / schema variance */
        }

        return {
            employees: withUser,
            byUserId,
            overridesByEmployeeDate,
            leaveByUserId,
            timezone: REPORT_TIME_ZONE,
        };
    }
}
