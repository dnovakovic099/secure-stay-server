import { Request, Response } from "express";
import { UserVerificationService } from "../services/UserVerificationService";

export class UserVerificationController {
  async verifyUser(request: Request, response: Response, fileLocation: string) {
    const userVerificationService = new UserVerificationService();
    return response.send(
      await userVerificationService.saveUserVerification(request, fileLocation)
    );
  }
}
