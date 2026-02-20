import { Request, Response } from "express";
import { MapsService } from "../services/MapsService";
import logger from "../utils/logger.utils";

export class MapsController {
  private mapsService = new MapsService();

  /**
   * Get all unique states from city_state_info table
   */
  getStates = async (req: Request, res: Response) => {
    try {
      const states = await this.mapsService.getStates();
      res.status(200).json({
        success: true,
        data: states,
      });
    } catch (error) {
      logger.error("Error fetching states:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch states",
      });
    }
  };

  /**
   * Get cities for a given state name
   */
  getCities = async (req: Request, res: Response) => {
    try {
      const { state } = req.query;

      if (!state || typeof state !== "string") {
        return res.status(400).json({
          success: false,
          message: "state query parameter is required",
        });
      }

      const cities = await this.mapsService.getCitiesByState(state);
      res.status(200).json({
        success: true,
        data: cities,
      });
    } catch (error) {
      logger.error("Error fetching cities:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch cities",
      });
    }
  };

  /**
   * Get all listings that can serve as reference properties
   */
  getListingsForReference = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId;
      const listings = await this.mapsService.getListingsForReference(userId);
      res.status(200).json({
        success: true,
        data: listings,
      });
    } catch (error) {
      logger.error("Error fetching listings for reference:", error);
      res.status(500).json({
        success: false,
        message: "Failed to fetch listings",
      });
    }
  };

  /**
   * Search for properties based on filters
   */
  searchProperties = async (req: Request, res: Response) => {
    try {
      const userId = (req as any).session?.userId;
      const { 
        state, 
        city, 
        propertyId, 
        startDate, 
        endDate, 
        guests, 
        maxTotalPrice,
        petsIncluded,
        numberOfPets 
      } = req.body;

      const properties = await this.mapsService.searchProperties(
        {
          state,
          city,
          propertyId: propertyId ? Number(propertyId) : undefined,
          startDate,
          endDate,
          guests: guests ? Number(guests) : undefined,
          maxTotalPrice: maxTotalPrice ? Number(maxTotalPrice) : undefined,
          petsIncluded: petsIncluded === true,
          numberOfPets: numberOfPets ? Number(numberOfPets) : 1,
        },
        userId
      );

      res.status(200).json({
        success: true,
        data: properties,
      });
    } catch (error) {
      logger.error("Error searching properties:", error);
      res.status(500).json({
        success: false,
        message: "Failed to search properties",
      });
    }
  };

  /**
   * Get distance between two properties
   */
  getDistance = async (req: Request, res: Response) => {
    try {
      const { propertyId1, propertyId2 } = req.query;

      if (!propertyId1 || !propertyId2) {
        return res.status(400).json({
          success: false,
          message: "propertyId1 and propertyId2 query parameters are required",
        });
      }

      const distance = await this.mapsService.getDistanceBetweenProperties(
        Number(propertyId1),
        Number(propertyId2)
      );

      if (!distance) {
        return res.status(404).json({
          success: false,
          message: "Could not calculate distance",
        });
      }

      res.status(200).json({
        success: true,
        data: distance,
      });
    } catch (error) {
      logger.error("Error getting distance:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get distance",
      });
    }
  };
}
