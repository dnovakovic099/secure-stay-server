import { Request, Response } from "express";
import { FaqService } from "../services/FaqService";

export class FaqController {
  async getAllFaqByReservation(request: Request, response: Response) {
    const faqService = new FaqService();
    return response.send(await faqService.getAllFaqByReservation(request));
  }
}
