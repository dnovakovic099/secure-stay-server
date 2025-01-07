import { Request } from "express";
import { appDatabase } from "../utils/database.util";
import { ClientEntity } from "../entity/Clients";
import { ClientListingEntity } from "../entity/ClientListings";

export class ClientService {
  private clientRepository = appDatabase.getRepository(ClientEntity);
  private clientListingRepository =
    appDatabase.getRepository(ClientListingEntity);

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
      baths,
      guests,
      beds,
      airDnaData,
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
    newClient.baths = baths;
    newClient.guests = guests;
    newClient.beds = beds;
    newClient.createdAt = new Date();
    newClient.updatedAt = new Date();

    const savedClient = await this.clientRepository.save(newClient);

    if (airDnaData) {
      const {
        combined_market_info,
        comps,
        compset_amenities,
        for_sale_property_comps,
        property_statistics,
        property_details,
      } = airDnaData as AirDnaScrappedDataResponse;
      const listing = new ClientListingEntity();
      listing.clientId = savedClient.id;
      listing.airdnaMarketName = combined_market_info.airdna_market_name;
      listing.marketType = combined_market_info.market_type;
      listing.marketScore = combined_market_info.market_score;
      listing.lat = property_details.location.lat;
      listing.lng = property_details.location.lng;
      listing.occupancy = property_statistics.occupancy.ltm;
      listing.address = property_details.address;
      listing.cleaningFee = property_statistics.cleaning_fee.ltm;
      listing.revenue = property_statistics.revenue.ltm;
      listing.totalComps = property_statistics.total_comps;
      listing.comps = comps;
      listing.forSalePropertyComps = for_sale_property_comps;
      listing.compsetAmenities = compset_amenities;
      listing.zipcode = property_details.zipcode;
      listing.revenueRange = property_statistics.revenue_range;
      listing.createdAt = new Date();
      listing.updatedAt = new Date();
      await this.clientListingRepository.save(listing);
    }
    return savedClient;
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

  async getClientListing(clientId: number) {
    const listing = await this.clientListingRepository.findOne({
      where: { clientId },
    });
    if (!listing) {
      return null;
    }
    return listing;
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
}
