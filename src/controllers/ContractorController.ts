import { Request, Response } from "express";
import { ContractorInfoService } from "../services/ContractorService";

interface CustomRequest extends Request {
    user?: any;
}

export class ContractorInfoController {
    async saveContractorInfo(request: CustomRequest, response: Response) {
        const contractorInfoService = new ContractorInfoService();;
        return response.send(await contractorInfoService.saveContractorInfo(request));
    }

    async getContractors(request: CustomRequest, response: Response) {
        const contractorInfoService = new ContractorInfoService();
        return response.send(await contractorInfoService.getContractors());
    }
}
