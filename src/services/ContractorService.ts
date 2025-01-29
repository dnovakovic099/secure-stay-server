import { appDatabase } from "../utils/database.util";
import { Request } from "express";
import { ContractorEntity } from "../entity/ContractorInfo";

export class ContractorInfoService {
    private contractorInfoRepo = appDatabase.getRepository(ContractorEntity);

    async saveContractorInfo(request: Request) {
        const { contractorName, contractorNumber } = request.body;

        const newContractor = new ContractorEntity();
        newContractor.contractorName = contractorName;
        newContractor.contractorNumber = contractorNumber;

        const contractor = await this.contractorInfoRepo.save(newContractor);
        return contractor;
    }

    async getContractors() {
        return await this.contractorInfoRepo.find();
    }

}
