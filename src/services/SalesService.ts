import { Request } from "express";
import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Sales";

export class ClientService {
  private clientRepository = appDatabase.getRepository(ClientEntity);

  async createClient(request: Request) {
    const {
      leadStatus,
      propertyAddress,
      city,
      state,
      country,
      ownerName,
      salesCloser,
      airDnaRevenue,
      commissionAmount,
      commissionStatus,
    } = request.body;

    if (
      !leadStatus ||
      !propertyAddress ||
      !city ||
      !state ||
      !country ||
      !ownerName ||
      !salesCloser
    ) {
      throw new Error("ClientService: Missing required fields");
    }

    const newClient = new ClientEntity();
    newClient.leadStatus = leadStatus;
    newClient.propertyAddress = propertyAddress;
    newClient.city = city;
    newClient.state = state;
    newClient.country = country;
    newClient.ownerName = ownerName;
    newClient.salesCloser = salesCloser;
    newClient.airDnaRevenue = airDnaRevenue;
    newClient.commissionAmount = commissionAmount;
    newClient.commissionStatus = commissionStatus;

    return await this.clientRepository.save(newClient);
  }
}
