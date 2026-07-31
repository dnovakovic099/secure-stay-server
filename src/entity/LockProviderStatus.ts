import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum LockProviderHealth {
  /** Never checked. */
  UNKNOWN = "unknown",
  /** Credentials present and the last probe succeeded. */
  OK = "ok",
  /** Credentials present, probe succeeded, but something is off (no devices, slow). */
  DEGRADED = "degraded",
  /** Credentials present but the last probe failed. */
  ERROR = "error",
  /** Required env vars are missing, so the provider was never usable. */
  UNCONFIGURED = "unconfigured",
}

@Entity("lock_provider_status")
export class LockProviderStatus {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  provider: string;

  @Column({ type: "varchar", length: 20, default: LockProviderHealth.UNKNOWN })
  status: LockProviderHealth;

  @Column({ name: "is_configured", default: false })
  isConfigured: boolean;

  @Column({ name: "last_checked_at", type: "timestamp", nullable: true })
  lastCheckedAt: Date;

  @Column({ name: "last_success_at", type: "timestamp", nullable: true })
  lastSuccessAt: Date;

  @Column({ name: "last_sync_at", type: "timestamp", nullable: true })
  lastSyncAt: Date;

  @Column({ name: "last_sync_device_count", default: 0 })
  lastSyncDeviceCount: number;

  @Column({ name: "latency_ms", type: "int", nullable: true })
  latencyMs: number;

  @Column({ name: "consecutive_failures", default: 0 })
  consecutiveFailures: number;

  @Column({ name: "last_error", type: "text", nullable: true })
  lastError: string;

  @Column({ type: "json", nullable: true })
  metadata: object;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
