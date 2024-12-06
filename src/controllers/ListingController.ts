import { NextFunction, Request, Response } from "express";
import { ListingService } from "../services/ListingService";
import { dataSaved, successDataFetch } from "../helpers/response";

interface CustomRequest extends Request {
  user?: any;
}

export class ListingController {
  async syncHostawayListing(request: CustomRequest, response: Response, next: NextFunction) {
    try {

      const listingService = new ListingService();
      const userId = request.user.id;

      await listingService.syncHostawayListing(userId);

      return response.status(200).json(dataSaved('Listing synced successfully!!!'));
    } catch (error) {
      return next(error);
    }
  }

  async getListings(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;

      const listings = await listingService.getListings(userId);

      return response.status(200).json(successDataFetch(listings));
    } catch (error) {
      return next(error);
    }
  }

  async getListingById(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;
      const listing_id = request.params.listing_id;

      const listing = await listingService.getListingById(listing_id, userId);

      return response.status(200).json(successDataFetch(listing));
    } catch (error) {
      return next(error);
    }
  }

  async getListingAddresses(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;

      const addresses = await listingService.getListingAddresses(userId);

      return response.status(200).json(successDataFetch(addresses));
    } catch (error) {
      return next(error);
    }
  }

  async saveListingScore(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const listingScore = await listingService.saveListingScore(request);
      return response.status(200).json(listingScore);
    } catch (error) {
      return next(error);
    }
  }

  async getListingScore(request: Request, response: Response, next: NextFunction) {
    {
      try {
        const listingService = new ListingService();
        const listingId = Number(request.query.listingId);
        const listingScore = await listingService.getListingScore(listingId);
        return response.status(200).json({
          success: true,
          message: 'Data found successfully!!!',
          data: listingScore
        });
      } catch (error) {
        return next(error);
      }
    }
  }

}
