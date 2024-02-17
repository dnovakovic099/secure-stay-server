import { Request, Response } from "express";
import { ListingService } from "../services/ListingService";

export class ListingController {
  async syncHostawayListing(request: Request, response: Response) {
    const listingService = new ListingService();
    return response.send(await listingService.syncHostawayListing());
  }

  async getListings(request: Request, response: Response) {
    const listingService = new ListingService();
    return response.send(await listingService.getListings())
  }

  async saveLockListingInfo(request: Request, response: Response) {
    const listingService = new ListingService()
    return response.send(await listingService.saveLockListingInfo(request));
  }
}
