import { Router, Request, Response } from "express";
import { SmartLockDeviceService } from "../services/SmartLockDeviceService";
import { SmartLockAccessCodeService } from "../services/SmartLockAccessCodeService";
import { LockProviderFactory } from "../providers/LockProviderFactory";
import { CodeGenerationMode } from "../entity/PropertyLockSettings";
import logger from "../utils/logger.utils";

const router = Router();
const deviceService = new SmartLockDeviceService();
const accessCodeService = new SmartLockAccessCodeService();

// =====================
// Lock Provider Routes
// =====================

/**
 * Create a connection URL for a lock provider
 * POST /smart-locks/connect/:provider
 */
router.post("/connect/:provider", async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { redirectUrl, failureRedirectUrl } = req.body;

    if (!LockProviderFactory.isProviderSupported(provider)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported provider: ${provider}`,
        supportedProviders: LockProviderFactory.getSupportedProviders(),
      });
    }

    const lockProvider = LockProviderFactory.getProvider(provider);
    const result = await lockProvider.createConnectionUrl({
      redirectUrl,
      failureRedirectUrl,
      providerCategory: "stable",
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error: any) {
    logger.error("Error creating connection URL:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create connection URL",
    });
  }
});

/**
 * Get connection status
 * GET /smart-locks/connect/:provider/status/:connectWebviewId
 */
router.get(
  "/connect/:provider/status/:connectWebviewId",
  async (req: Request, res: Response) => {
    try {
      const { provider, connectWebviewId } = req.params;

      const lockProvider = LockProviderFactory.getProvider(provider);
      const status = await lockProvider.getConnectionStatus(connectWebviewId);

      return res.json({
        success: true,
        data: status,
      });
    } catch (error: any) {
      logger.error("Error getting connection status:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get connection status",
      });
    }
  }
);

/**
 * Sync devices from provider after connection
 * POST /smart-locks/devices/sync/:provider
 */
router.post("/devices/sync/:provider", async (req: Request, res: Response) => {
  try {
    const { provider } = req.params;
    const { connectedAccountId } = req.body;

    const devices = await deviceService.syncDevicesFromProvider(
      provider,
      connectedAccountId
    );

    return res.json({
      success: true,
      data: devices,
      message: `Synced ${devices.length} devices`,
    });
  } catch (error: any) {
    logger.error("Error syncing devices:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to sync devices",
    });
  }
});

// =====================
// Device Routes
// =====================

/**
 * Get all devices
 * GET /smart-locks/devices
 */
router.get("/devices", async (req: Request, res: Response) => {
  try {
    const devices = await deviceService.getAllDevices();
    return res.json({
      success: true,
      data: devices,
    });
  } catch (error: any) {
    logger.error("Error getting devices:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get devices",
    });
  }
});

/**
 * Get device by ID
 * GET /smart-locks/devices/:id
 */
router.get("/devices/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const device = await deviceService.getDeviceById(parseInt(id));

    if (!device) {
      return res.status(404).json({
        success: false,
        message: "Device not found",
      });
    }

    return res.json({
      success: true,
      data: device,
    });
  } catch (error: any) {
    logger.error("Error getting device:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get device",
    });
  }
});

// =====================
// Property Device Mapping Routes
// =====================

/**
 * Get all property mappings
 * GET /smart-locks/property-devices
 */
router.get("/property-devices", async (req: Request, res: Response) => {
  try {
    const mappings = await deviceService.getAllMappings();
    return res.json({
      success: true,
      data: mappings,
    });
  } catch (error: any) {
    logger.error("Error getting all property devices:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get all property devices",
    });
  }
});

/**
 * Get devices for a property
 * GET /smart-locks/property-devices/:propertyId
 */
router.get(
  "/property-devices/:propertyId",
  async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.params;
      const devices = await deviceService.getDevicesForProperty(
        parseInt(propertyId)
      );

      return res.json({
        success: true,
        data: devices,
      });
    } catch (error: any) {
      logger.error("Error getting property devices:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get property devices",
      });
    }
  }
);

/**
 * Map a device to a property
 * POST /smart-locks/property-devices
 */
router.post("/property-devices", async (req: Request, res: Response) => {
  try {
    const { deviceId, propertyId, locationLabel } = req.body;

    if (!deviceId || !propertyId) {
      return res.status(400).json({
        success: false,
        message: "deviceId and propertyId are required",
      });
    }

    const mapping = await deviceService.mapDeviceToProperty(
      deviceId,
      propertyId,
      locationLabel
    );

    return res.json({
      success: true,
      data: mapping,
      message: "Device mapped to property successfully",
    });
  } catch (error: any) {
    logger.error("Error mapping device to property:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to map device to property",
    });
  }
});

/**
 * Remove device-property mapping
 * DELETE /smart-locks/property-devices/:propertyId/:deviceId
 */
router.delete(
  "/property-devices/:propertyId/:deviceId",
  async (req: Request, res: Response) => {
    try {
      const { propertyId, deviceId } = req.params;

      await deviceService.unmapDeviceFromProperty(
        parseInt(deviceId),
        parseInt(propertyId)
      );

      return res.json({
        success: true,
        message: "Mapping removed successfully",
      });
    } catch (error: any) {
      logger.error("Error removing mapping:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to remove mapping",
      });
    }
  }
);

// =====================
// Property Lock Settings Routes
// =====================

/**
 * Get all property lock settings
 * GET /smart-locks/settings
 */
router.get("/settings", async (req: Request, res: Response) => {
  try {
    const settings = await accessCodeService.getAllSettings();
    return res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    logger.error("Error getting all settings:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get all settings",
    });
  }
});

/**
 * Get property lock settings for a specific property
 * GET /smart-locks/settings/:propertyId
 */
router.get("/settings/:propertyId", async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const settings = await accessCodeService.getOrCreateSettings(
      parseInt(propertyId)
    );

    return res.json({
      success: true,
      data: settings,
    });
  } catch (error: any) {
    logger.error("Error getting settings:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get settings",
    });
  }
});

/**
 * Update property lock settings
 * PUT /smart-locks/settings/:propertyId
 */
router.put("/settings/:propertyId", async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const updates = req.body;

    // Validate code generation mode if provided
    if (
      updates.codeGenerationMode &&
      !Object.values(CodeGenerationMode).includes(updates.codeGenerationMode)
    ) {
      return res.status(400).json({
        success: false,
        message: `Invalid codeGenerationMode. Must be one of: ${Object.values(
          CodeGenerationMode
        ).join(", ")}`,
      });
    }

    const settings = await accessCodeService.updateSettings(
      parseInt(propertyId),
      updates
    );

    return res.json({
      success: true,
      data: settings,
      message: "Settings updated successfully",
    });
  } catch (error: any) {
    logger.error("Error updating settings:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update settings",
    });
  }
});

/**
 * Delete/Reset property lock settings
 * DELETE /smart-locks/settings/:propertyId
 */
router.delete("/settings/:propertyId", async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    await accessCodeService.deleteSettings(parseInt(propertyId));

    return res.json({
      success: true,
      message: "Settings reset successfully",
    });
  } catch (error: any) {
    logger.error("Error deleting settings:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete settings",
    });
  }
});

// =====================
// Access Code Routes
// =====================

/**
 * Get all access codes
 * GET /smart-locks/access-codes
 */
router.get("/access-codes", async (req: Request, res: Response) => {
  try {
    const codes = await accessCodeService.getAllAccessCodes();
    return res.json({
      success: true,
      data: codes,
    });
  } catch (error: any) {
    logger.error("Error getting all access codes:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get all access codes",
    });
  }
});

/**
 * Get access codes for a property
 * GET /smart-locks/access-codes/property/:propertyId
 */
router.get(
  "/access-codes/property/:propertyId",
  async (req: Request, res: Response) => {
    try {
      const { propertyId } = req.params;
      const codes = await accessCodeService.getAccessCodesForProperty(
        parseInt(propertyId)
      );

      return res.json({
        success: true,
        data: codes,
      });
    } catch (error: any) {
      logger.error("Error getting access codes:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get access codes",
      });
    }
  }
);

/**
 * Get access codes for a reservation
 * GET /smart-locks/access-codes/reservation/:reservationId
 */
router.get(
  "/access-codes/reservation/:reservationId",
  async (req: Request, res: Response) => {
    try {
      const { reservationId } = req.params;
      const codes = await accessCodeService.getAccessCodesForReservation(
        parseInt(reservationId)
      );

      return res.json({
        success: true,
        data: codes,
      });
    } catch (error: any) {
      logger.error("Error getting access codes:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to get access codes",
      });
    }
  }
);

/**
 * Create access codes for a reservation (auto-generate for all property devices)
 * POST /smart-locks/access-codes/generate-for-reservation
 */
router.post(
  "/access-codes/generate-for-reservation",
  async (req: Request, res: Response) => {
    try {
      const { reservationId, propertyId, guestName, guestPhone, checkInDate } =
        req.body;

      if (!reservationId || !propertyId || !checkInDate) {
        return res.status(400).json({
          success: false,
          message: "reservationId, propertyId, and checkInDate are required",
        });
      }

      const codes = await accessCodeService.createAccessCodesForReservation({
        reservationId,
        propertyId,
        guestName,
        guestPhone,
        checkInDate: new Date(checkInDate),
      });

      return res.json({
        success: true,
        data: codes,
        message: `Created ${codes.length} access code(s)`,
      });
    } catch (error: any) {
      logger.error("Error generating access codes:", error);
      return res.status(500).json({
        success: false,
        message: error.message || "Failed to generate access codes",
      });
    }
  }
);

/**
 * Create a manual access code
 * POST /smart-locks/access-codes
 */
router.post("/access-codes", async (req: Request, res: Response) => {
  try {
    const {
      deviceId,
      propertyId,
      code,
      codeName,
      guestName,
      guestPhone,
      reservationId,
      setImmediately,
    } = req.body;

    if (!deviceId || !propertyId || !code || !codeName) {
      return res.status(400).json({
        success: false,
        message: "deviceId, propertyId, code, and codeName are required",
      });
    }

    const accessCode = await accessCodeService.createManualAccessCode({
      deviceId,
      propertyId,
      code,
      codeName,
      guestName,
      guestPhone,
      reservationId,
      setImmediately,
    });

    return res.json({
      success: true,
      data: accessCode,
      message: setImmediately
        ? "Access code created and set on device"
        : "Access code created",
    });
  } catch (error: any) {
    logger.error("Error creating access code:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to create access code",
    });
  }
});

/**
 * Set access code on device immediately
 * POST /smart-locks/access-codes/:id/set-now
 */
router.post("/access-codes/:id/set-now", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const accessCode = await accessCodeService.setAccessCodeOnDevice(
      parseInt(id)
    );

    return res.json({
      success: true,
      data: accessCode,
      message:
        accessCode.status === "set"
          ? "Access code set successfully"
          : "Failed to set access code",
    });
  } catch (error: any) {
    logger.error("Error setting access code:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to set access code",
    });
  }
});

/**
 * Delete access code
 * DELETE /smart-locks/access-codes/:id
 */
router.delete("/access-codes/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    await accessCodeService.deleteAccessCode(parseInt(id));

    return res.json({
      success: true,
      message: "Access code deleted successfully",
    });
  } catch (error: any) {
    logger.error("Error deleting access code:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete access code",
    });
  }
});

/**
 * Get supported providers
 * GET /smart-locks/providers
 */
router.get("/providers", async (req: Request, res: Response) => {
  try {
    const providers = LockProviderFactory.getSupportedProviders();
    return res.json({
      success: true,
      data: providers,
    });
  } catch (error: any) {
    logger.error("Error getting providers:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get providers",
    });
  }
});

export default router;
