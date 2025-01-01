import { Request } from "express";
import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Sales";
import { scrapeAndForwardData } from "../web-scrapper/extractDataFromAirDna";

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
    newClient.createdAt = new Date();
    newClient.updatedAt = new Date();

    return await this.clientRepository.save(newClient);
  }
  async getAllClients() {
    return await this.clientRepository.find();
  }
  async updateClient(clientId: number, updateData: Partial<ClientEntity>) {
    const client = await this.clientRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      return null;
    }

    const updatedClient = {
      ...client,
      ...updateData,
      updatedAt: new Date(),
    };

    Object.assign(client, updatedClient);

    return await this.clientRepository.save(client);
  }
  async generatePdfForClient(clientId: number, data: Partial<ClientEntity>) {
    const { propertyAddress, city, state, country } = data;
    const completeAddress = `${propertyAddress}, ${city}, ${state}, ${country}`;

    const pdfPath = await scrapeAndForwardData(completeAddress, clientId);
    if (!pdfPath) {
      return null;
    }
    const updatedData = {
      ...data,
      previewDocumentLink: pdfPath,
      updatedAt: new Date(),
    };

    return await this.clientRepository.save(updatedData);
  }
}
