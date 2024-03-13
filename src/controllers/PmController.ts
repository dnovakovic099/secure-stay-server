import { Request, Response } from "express";
import { PmServices } from "../services/PmServices";

export class PmController {

    async getPropertyManagementList(request: Request, response: Response) {
        const pmListServices = new PmServices();
        response.send(await pmListServices.getPropertyManagementList());
    }

    async saveUsersPmSoftware(request: Request, response: Response) {
        const saveUsersPmSoftwareService = new PmServices();
        response.send(await saveUsersPmSoftwareService.saveUsersPmSoftware(request));
    }

    async getUserPmSoftwareList(request: Request, response: Response) {
        const userPmSoftwareListService = new PmServices();
        response.send(await userPmSoftwareListService.getUserPmSoftwareList(request));

    }

    async createUserPmSoftware(request: Request, response: Response) {
        const userPmSoftwareService = new PmServices();
        response.send(await userPmSoftwareService.createUserPmSoftware(request));
    }

    async getUserPmList(request: Request, response: Response) {
        const getUserPmListService = new PmServices();
        response.send(await getUserPmListService.getUserPmList(request));
    }
}
