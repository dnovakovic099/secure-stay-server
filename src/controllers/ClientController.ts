import { NextFunction, Request, Response } from "express";
import { ClientService } from "../services/ClientService";

interface CustomRequest extends Request {
  user?: any;
}

export class ClientController {
  async createClient(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const { primaryContact, secondaryContacts, properties } = request.body;
      const userId = request.user.id;
      const createdClient = await clientService.saveClient(primaryContact, userId, secondaryContacts, properties);
      return response.status(201).json(createdClient);
    } catch (error) {
      next(error);
    }
  }

  async updateClient(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const { primaryContact, secondaryContacts, properties } = request.body;
      const userId = request.user.id;

      const updatedClient = await clientService.updateClient(
        primaryContact,
        userId,
        secondaryContacts,
        properties
      );
      return response.status(200).json(updatedClient);
    } catch (error) {
      next(error);
    }
  }

  async deleteClient(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      await clientService.deleteClient(request.params.id, request.user.id);
      return response.status(200).json({ message: "Client deleted successfully." });
    } catch (error) {
      next(error);
    }
  }

  async getClients(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const filters = {
        page: request.query.page ? parseInt(request.query.page as string, 10) : 1,
        limit: request.query.limit ? parseInt(request.query.limit as string, 10) : 10,
        keyword: request.query.keyword as string | undefined,
        listingId: request.query.listingId ? (Array.isArray(request.query.listingId) ? request.query.listingId : [request.query.listingId]) as string[] : undefined,
        serviceType: request.query.serviceType ? (Array.isArray(request.query.serviceType) ? request.query.serviceType : [request.query.serviceType]) as string[] : undefined,
        status: request.query.status ? (Array.isArray(request.query.status) ? request.query.status : [request.query.status]) as string[] : undefined,
      };
      const { total, data, satisfactionCounts } = await clientService.getClientList(filters, request.user.id);

      const summaryInfo = await clientService.getClientMetadata();

      return response.status(200).json({ total, summaryInfo, satisfactionCounts, data });
    } catch (error) {
      next(error);
    }
  }

  async savePropertyPreOnboardingInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.savePropertyPreOnboardingInfo(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getPropertyPreOnboardingInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const { clientId } = request.params as { clientId: string; };
      const result = await clientService.getPropertyPreOnboardingInfo(clientId);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getSalesRepresentativeList(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.getSalesRepresentativeList();
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updatePropertyPreOnboardingInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updatePropertyPreOnboardingInfo(request.body, request.user.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }


  async saveOnboardingDetails(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.saveOnboardingDetails(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updatedOnboardingDetails(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updatedOnboardingDetails(request.body, request.user.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async saveServiceInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.saveServiceInfo(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateServiceInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updateServiceInfo(request.body, request.user.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async getClientDetails(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.getClientDetails(request.params.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async saveListingInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.saveListingInfo(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateListingInfo(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updateListingInfo(request.body, request.user.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async saveOnboardingDetailsClientForm(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.saveOnboardingDetailsClientForm(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateOnboardingDetailsClientForm(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updateOnboardingDetailsClientForm(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async saveListingDetailsClientForm(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.saveListingDetailsClientForm(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateListingDetailsClientForm(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updateListingDetailsClientForm(request.body, request.user.id);
      return response.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateFinancialsInternalForm(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updateFinancialsInternalForm(request.body, request.user.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

  async updateManagementInternalForm(request: CustomRequest, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      const result = await clientService.updateManagementInternalForm(request.body, request.user.id);
      return response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }

}
