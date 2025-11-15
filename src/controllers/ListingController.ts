import { NextFunction, Request, Response } from "express";
import { ListingService } from "../services/ListingService";
import { dataSaved, successDataFetch } from "../helpers/response";
import { tagIds } from "../constant";

interface CustomRequest extends Request {
  user?: any;
}

export class ListingController {
  async syncHostawayListing(request: CustomRequest, response: Response, next: NextFunction) {
    try {

      const listingService = new ListingService();
      const userId = request.user.id;

      await listingService.syncHostifyListings(userId);

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

  async getListingNames(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;
      const listingNames = await listingService.getListingNames(userId);

      return response.status(200).json(successDataFetch(listingNames));
    } catch (error) {
      return next(error);
    }
  }

  async saveListingUpdate(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;
      const listingUpdate = request.body;
      await listingService.saveListingUpdate(listingUpdate, userId);

      return response.status(200).json(dataSaved('Listing updates saved successfully!!!'));
    } catch (error) {
      return next(error);
    }
  }

  async getListingUpdates(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const listingId = Number(request.params.listingId);
      const userId = request.user.id;
      const page = Number(request.query.page);

      const listingUpdates = await listingService.getListingUpdates(listingId, userId, page);

      return response.status(200).json(successDataFetch(listingUpdates));
    } catch (error) {
      return next(error);
    }
  }


  async saveListingDetails(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;
      const body = request.body;

      await listingService.saveListingDetails(body, userId);

      return response.status(200).json(dataSaved('Listing details saved successfully!!!'));
    } catch (error) {
      return next(error);
    }
  }

  async getListingDetail(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const listingId = Number(request.query.listingId);

      const listingDetail = await listingService.getListingDetail(listingId);

      return response.status(200).json(successDataFetch(listingDetail));
    } catch (error) {
      return next(error);
    }
  }

  async getPmListings(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const userId = request.user.id;
      const pmListings = await listingService.getPmListings();

      return response.status(200).json(successDataFetch(pmListings));
    } catch (error) {
      return next(error);
    }
  }

  async getStates(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const states = await listingService.getStates();
      return response.status(200).json(successDataFetch(states));
    } catch (error) {
      return next(error);
    }
  }

  async getCities(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const states = await listingService.getCities();
      return response.status(200).json(successDataFetch(states));
    } catch (error) {
      return next(error);
    }
  }

  async getPropertyTypes(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const propertyTypes = await listingService.getPropertyTypes();
      return response.status(200).json(successDataFetch(propertyTypes));
    } catch (error) {
      return next(error);
    }
  }

  async getCountries(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const countries = await listingService.getCountries();
      return response.status(200).json(successDataFetch(countries));
    } catch (error) {
      return next(error);
    }
  }

  async getAmenities(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const amenities = await listingService.getAmenities();
      return response.status(200).json(successDataFetch(amenities));
    } catch (error) {
      return next(error);
    }
  }

  async getBedTypes(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const bedTypes = await listingService.getBedTypes();
      return response.status(200).json(successDataFetch(bedTypes));
    } catch (error) {
      return next(error);
    }
  }

  async getCurrencies(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const currencies = await listingService.getCurrencies();
      return response.status(200).json(successDataFetch(currencies));
    } catch (error) {
      return next(error);
    }
  }

  async getCancellationPolicies(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const cancellationPolicies = await listingService.getCancellationPolicies(request.query.channel as string);
      return response.status(200).json(successDataFetch(cancellationPolicies));
    } catch (error) {
      return next(error);
    }
  }

  async getTimeZones(request: Request, response: Response, next: NextFunction) {
    try {
      const listingService = new ListingService();
      const timeZones = await listingService.getTimezones();
      return response.status(200).json(successDataFetch(timeZones));
    } catch (error) {
      return next(error);
    }
  }

}
