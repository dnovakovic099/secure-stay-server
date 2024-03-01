import { Request, Response } from "express";
import { GuideBookService } from "../services/GuideBookService";

export class GuideBookController {
  async PostGuideBook(request: Request, response: Response) {
    const guideBokService = new GuideBookService();

    return response.send(await guideBokService.PostGuides(request));
  }

  async UpdateGuideBook(request: Request, response: Response) {
    const guideBokService = new GuideBookService();
    return response.send(await guideBokService.UpdateGuides(request));
  }
  async DeleteGuideBook(request: Request, response: Response) {
    const guideBokService = new GuideBookService();

    return response.send(await guideBokService.DeleteGuides(request));
  }
}

// async getListings(request: Request, response: Response) {
//   const listingService = new ListingService();
//   return response.send(await listingService.getListings());
// }

// async getListingById(request: Request, response: Response) {
//   const listingService = new ListingService();
//   return response.send(await listingService.getListingById(request));
// }
