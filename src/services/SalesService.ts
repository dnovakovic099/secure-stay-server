import { Request } from "express";
import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Clients";
import { ClientListingEntity } from "../entity/ClientListings";

export class ClientService {
  private clientRepository = appDatabase.getRepository(ClientEntity);
  private clientListingRepository =
    appDatabase.getRepository(ClientListingEntity);

  async createClient(request: Request, fileNames?: string[]) {
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
      baths,
      guests,
      beds,
      addressData,
      propertyData,
    } = request.body;

    const newClient = this.clientRepository.create({
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
      baths,
      guests,
      beds,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const savedClient = await this.clientRepository.save(newClient);
    console.log("body==>>", request.body);
    const {
      combined_market_info,
      comps,
      compset_amenities,
      for_sale_property_comps,
      property_statistics,
      property_details,
      screenshotSessionId,
    } = addressData as AirDnaScrappedDataResponse;

    console.log("airDna==>>", addressData);

    const { ssid, details, metrics, platforms } =
      propertyData as IScrappedPropertyData;
    console.log("propertyData==>>", propertyData);

    const currentDate = new Date();
    const listing = this.clientListingRepository.create({
      clientId: savedClient.id,
      airdnaMarketName: combined_market_info.airdna_market_name,
      marketType: combined_market_info.market_type,
      marketScore: combined_market_info.market_score,
      lat: property_details.location.lat,
      lng: property_details.location.lng,
      occupancy: property_statistics.occupancy.ltm,
      address: property_details.address,
      cleaningFee: property_statistics.cleaning_fee.ltm,
      revenue: property_statistics.revenue.ltm,
      totalComps: property_statistics.total_comps,
      comps,
      forSalePropertyComps: for_sale_property_comps,
      compsetAmenities: compset_amenities,
      zipcode: property_details.zipcode,
      revenueRange: property_statistics.revenue_range,
      screenshotSessionId,
      propertyScreenshotSessionId: ssid,
      details,
      metrics,
      vrboPropertyId: platforms.vrbo_property_id,
      airBnbPropertyId: platforms.airbnb_property_id,
      createdAt: currentDate,
      updatedAt: currentDate,
    });

    await this.clientListingRepository.save(listing);

    return savedClient;
  }
  async getAllClients() {
    return await this.clientRepository.find();
  }
  async updateClient(clientId: number, updateData: Partial<ClientEntity>, userId: string) {
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
      updatedBy: userId
    };

    Object.assign(client, updatedClient);

    return await this.clientRepository.save(client);
  }

  async updateClientListing(
    clientId: number,
    updateData: Partial<ClientListingEntity>
  ) {
    const clientListing = await this.clientListingRepository.findOne({
      where: { clientId },
    });

    if (!clientListing) {
      return null;
    }

    const updatedListing = {
      ...clientListing,
      ...updateData,
      updatedAt: new Date(),
    };

    Object.assign(clientListing, updatedListing);

    return await this.clientListingRepository.save(clientListing);
  }

  async getClientListing(clientId: number) {
    const listing = await this.clientListingRepository.findOne({
      where: { clientId },
    });
    const client = await this.clientRepository.findOne({
      where: { id: clientId },
    });
    if (!listing || !client) {
      return null;
    }
    return {
      listing,
      client,
    };
  }
  async saveGeneratedPdfLink(
    clientId: number,
    pdfLink: string
  ): Promise<boolean> {
    const client = await this.clientRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      return false;
    }

    // Update the PDF link
    client.previewDocumentLink = pdfLink;
    await this.clientRepository.save(client);

    return true;
  }

  async checkIfClientWasUpdated(clientId: number) {
    const client = await this.clientRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      return false;
    }

    return client.updatedAt > client.createdAt;
  }
}
