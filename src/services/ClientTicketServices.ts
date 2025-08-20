import { Between, ILike, In, Raw } from "typeorm";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { appDatabase } from "../utils/database.util";
import CustomErrorHandler from "../middleware/customError.middleware";
import { UsersEntity } from "../entity/Users";
import { ListingService } from "./ListingService";
import { tagIds } from "../constant";
import { setSelectedSlackUsers } from "../helpers/helpers";

interface LatestUpdates {
    id?: number;
    updates: string;
    isDeleted?: boolean;
}

interface ClientTicketFilter {
    status?: string[];
    listingId?: string[];
    category?: string[];
    fromDate?: string;
    toDate?: string;
    page: number;
    limit: number;
    ids?: number[];
    propertyType?: number[];
    keyword?: string;
}


export class ClientTicketService {
    private clientTicketRepo = appDatabase.getRepository(ClientTicket);
    private clientTicketUpdateRepo = appDatabase.getRepository(ClientTicketUpdates);
    private usersRepo = appDatabase.getRepository(UsersEntity);

    private async createClientTicket(ticketData: Partial<ClientTicket>, userId: string) {
        const newTicket = this.clientTicketRepo.create({
            ...ticketData,
            createdBy: userId,
        });
        return await this.clientTicketRepo.save(newTicket);
    }

    private async createClientTicketUpdates(clientTicket: ClientTicket, latestUpdates: LatestUpdates[], userId: string) {
        const updatesToSave = latestUpdates.map(update => {
            const newUpdate = this.clientTicketUpdateRepo.create({
                ...update,
                clientTicket: clientTicket,
                createdBy: userId,
            });
            return newUpdate;
        });
        return await this.clientTicketUpdateRepo.save(updatesToSave);
    }

    public async saveClientTicketUpdates(body: any, userId: string) {
        const { ticketId, updates } = body;

        const clientTicket = await this.clientTicketRepo.findOne({ where: { id: ticketId } });
        if (!clientTicket) {
            throw CustomErrorHandler.notFound(`Client ticket with id ${ticketId} not found`);
        }

        const newUpdate = this.clientTicketUpdateRepo.create({
            updates,
            clientTicket,
            createdBy: userId
        });

        await this.clientTicketUpdateRepo.save(newUpdate);
        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        newUpdate.createdBy = userMap.get(newUpdate.createdBy) || newUpdate.createdBy;
        newUpdate.updatedBy = userMap.get(newUpdate.updatedBy) || newUpdate.updatedBy;
        return newUpdate;
    }

    public async saveClientTicketWithUpdates(body: any, userId: string) {
        const { latestUpdates, mentions } = body;
        const ticketData: Partial<ClientTicket> = {
            status: body.status,
            listingId: body.listingId,
            category: JSON.stringify(body.category),
            description: body.description,
            resolution: body.resolution,
            clientSatisfaction: body.clientSatisfaction
        };
        if (body.category.includes("Other") && mentions && mentions.length > 0) {
            setSelectedSlackUsers(mentions);
        }
        const clientTicket = await this.createClientTicket(ticketData, userId);
        latestUpdates && await this.createClientTicketUpdates(clientTicket, latestUpdates, userId);

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        clientTicket.createdBy = userMap.get(clientTicket.createdBy) || clientTicket.createdBy;
        clientTicket.updatedBy = userMap.get(clientTicket.updatedBy) || clientTicket.updatedBy;
        return clientTicket;
    }

    public async getClientTicket(body: ClientTicketFilter, userId: string) {
        const { status, listingId, category, fromDate, toDate, page, limit, ids, propertyType, keyword } = body;

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        let listingIds = [];
        const listingService = new ListingService();
        
        if (propertyType && propertyType.length > 0) {
            listingIds = (await listingService.getListingsByTagIds(propertyType, userId)).map(l => l.id);
        } else {
            listingIds = listingId;
        }

        const [clientTickets, total] = await this.clientTicketRepo.findAndCount({
            where: {
                ...(ids?.length > 0 && { id: In(ids) }),
                ...(status && status.length > 0 && { status: In(status) }),
                ...(listingIds && listingIds.length > 0 && { listingId: In(listingIds) }),
                ...(category && category.length > 0 && { 
                    category: Raw(alias => category.map(cat => `${alias} LIKE '%${cat}%'`).join(' OR '))
                }),
                ...(fromDate && toDate && { createdAt: Between(new Date(fromDate), new Date(toDate)) }),
                ...(keyword && { description: ILike(`%${keyword}%`) }),
            },
            relations: ["clientTicketUpdates"],
            skip: (page - 1) * limit,
            take: limit,
            order: {
                id: "DESC"
            }
        });

        const listings = await listingService.getListingsByTagIds([tagIds.PM]);

        const transformedTickets = clientTickets.map(ticket => {
            return {
                ...ticket,
                listingName: listings.find((listing) => listing.id == Number(ticket.listingId))?.internalListingName,
                createdBy: userMap.get(ticket.createdBy) || ticket.createdBy,
                updatedBy: userMap.get(ticket.updatedBy) || ticket.updatedBy,
                clientTicketUpdates: ticket.clientTicketUpdates.map(update => ({
                    ...update,
                    createdBy: userMap.get(update.createdBy) || update.createdBy,
                    updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
                })),
            };
        });

        return {
            clientTickets: transformedTickets,
            total
        };
    }

    public async getClientTicketById(id: number) {
        const clientTicket = await this.clientTicketRepo.findOne({
            where: { id },
            relations: ["clientTicketUpdates"],
        });

        if (!clientTicket) {
            throw CustomErrorHandler.notFound(`Client ticket with ID ${id} not found.`);
        }

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        clientTicket.createdBy = userMap.get(clientTicket.createdBy) || clientTicket.createdBy;
        clientTicket.updatedBy = userMap.get(clientTicket.updatedBy) || clientTicket.updatedBy;
        clientTicket.clientTicketUpdates= clientTicket.clientTicketUpdates.map(update => ({
            ...update,
            createdBy: userMap.get(update.createdBy) || update.createdBy,
            updatedBy: userMap.get(update.updatedBy) || update.updatedBy,
        }))

        return clientTicket;
    }

    public async updateClientTicketUpdates(
        ticketId: number,
        updates: LatestUpdates[],
        userId: string
    ) {
        const clientTicket = await this.getClientTicketById(ticketId);
        if (!clientTicket) {
            throw CustomErrorHandler.notFound(`Client ticket with ID ${ticketId} not found.`);
        }

        // if updates have id then update that particular clientTicketUpdate else create new clientTicketupdate
        const updatesToSave = updates.map(update => {
            if (update.id) {
                return this.clientTicketUpdateRepo.save({
                    ...update,
                    updatedBy: userId,
                    clientTicket: clientTicket,
                    ...(update.isDeleted && { deletedBy: userId, deletedAt: new Date() }),
                });
            } else {
                const newUpdate = this.clientTicketUpdateRepo.create({
                    ...update,
                    clientTicket: clientTicket,
                    createdBy: userId,
                });
                return this.clientTicketUpdateRepo.save(newUpdate);
            }
        });

        return await Promise.all(updatesToSave);
    }

    public async updateClientTicketWithUpdates(body: any, userId: string) {
        const { latestUpdates, id } = body;
        const ticketData: Partial<ClientTicket> = {
            status: body.status,
            listingId: body.listingId,
            category: JSON.stringify(body.category),
            description: body.description,
            resolution: body.resolution,
            clientSatisfaction: body.clientSatisfaction
        };

        const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
        if (!clientTicket) {
            throw CustomErrorHandler.notFound(`Client ticket with ID ${id} not found.`);
        }

        Object.assign(clientTicket, ticketData, {
            updatedBy: userId,
            updatedAt: new Date(),
            ...(ticketData.status == "Completed" && {
                completedOn: new Date(),
                completedBy: userId
            })
        });
        await this.clientTicketRepo.save(clientTicket);
        latestUpdates && await this.updateClientTicketUpdates(id, latestUpdates, userId);

        return clientTicket;
    }

    public async deleteClientTicket(id: number, userId: string) {
        const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
        if (!clientTicket) {
            throw CustomErrorHandler.notFound(`Client ticket with ID ${id} not found.`);
        }

        clientTicket.deletedBy = userId;
        clientTicket.deletedAt = new Date();
        await this.clientTicketRepo.save(clientTicket);

        return { message: `Client ticket with ID ${id} deleted successfully.` };
    }

    public async updateClientTicketStatus(id: number, status: string, userId: string) {
        const clientTicket = await this.clientTicketRepo.findOne({ where: { id } });
        if (!clientTicket) {
            throw CustomErrorHandler.notFound(`Client ticket with ID ${id} not found.`);
        }

        clientTicket.status = status;
        clientTicket.updatedBy = userId;

        if (status === "Completed") {
            clientTicket.completedOn = new Date().toISOString();;
            clientTicket.completedBy = userId;
        }

        await this.clientTicketRepo.save(clientTicket);

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        clientTicket.createdBy = userMap.get(clientTicket.createdBy) || clientTicket.createdBy;
        clientTicket.updatedBy = userMap.get(clientTicket.updatedBy) || clientTicket.updatedBy;
        return clientTicket;
    }


    public async updateTicketUpdates(body: any, userId: string) {
        const { id, updates } = body;
        const ticketUpdates = await this.clientTicketUpdateRepo.findOne({ where: { id } });
        if (!ticketUpdates) {
            throw CustomErrorHandler.notFound(`Ticket update with ${id} not found.`);
        }

        ticketUpdates.updates = updates;
        ticketUpdates.updatedBy = userId;

        await this.clientTicketUpdateRepo.save(ticketUpdates);

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        ticketUpdates.createdBy = userMap.get(ticketUpdates.createdBy) || ticketUpdates.createdBy;
        ticketUpdates.updatedBy = userMap.get(ticketUpdates.updatedBy) || ticketUpdates.updatedBy;

        return ticketUpdates;
    }

    public async deleteClientTicketUpdate(id: number, userId: string) {
        const clientTicketUpdate = await this.clientTicketUpdateRepo.findOne({ where: { id } });
        if (!clientTicketUpdate) {
            throw CustomErrorHandler.notFound(`Client ticket with ID ${id} not found.`);
        }

        clientTicketUpdate.deletedBy = userId;
        clientTicketUpdate.deletedAt = new Date();
        await this.clientTicketUpdateRepo.save(clientTicketUpdate);

        return { message: `Client ticket update with ID ${id} deleted successfully.` };
    }

    public async bulkUpdateClientTickets(ids: number[], updateData: Partial<ClientTicket>, userId: string) {
        try {
            // Validate that all client tickets exist
            const existingClientTickets = await this.clientTicketRepo.find({
                where: { id: In(ids) }
            });

            if (existingClientTickets.length !== ids.length) {
                const foundIds = existingClientTickets.map(ticket => ticket.id);
                const missingIds = ids.filter(id => !foundIds.includes(id));
                throw CustomErrorHandler.notFound(`Client tickets with IDs ${missingIds.join(', ')} not found`);
            }

            // Update all client tickets with the provided data
            const updatePromises = existingClientTickets.map(async (clientTicket) => {
                // Only update fields that are provided in updateData
                if (updateData.status !== undefined) {
                    clientTicket.status = updateData.status;
                    
                    // Handle completedOn and completedBy logic for status changes
                    if (updateData.status === 'Completed' && clientTicket.status !== 'Completed') {
                        clientTicket.completedOn = new Date().toISOString();
                        clientTicket.completedBy = userId;
                    } else if (updateData.status !== 'Completed' && clientTicket.status === 'Completed') {
                        clientTicket.completedOn = null;
                        clientTicket.completedBy = null;
                    }
                }
                if (updateData.listingId !== undefined) {
                    clientTicket.listingId = updateData.listingId;
                }
                if (updateData.category !== undefined) {
                    clientTicket.category = typeof updateData.category === 'string' 
                        ? updateData.category 
                        : JSON.stringify(updateData.category);
                }
                if (updateData.description !== undefined) {
                    clientTicket.description = updateData.description;
                }
                if (updateData.resolution !== undefined) {
                    clientTicket.resolution = updateData.resolution;
                }
                if (updateData.clientSatisfaction !== undefined) {
                    clientTicket.clientSatisfaction = updateData.clientSatisfaction;
                }
                
                clientTicket.updatedBy = userId;
                clientTicket.updatedAt = new Date();
                return this.clientTicketRepo.save(clientTicket);
            });

            const updatedClientTickets = await Promise.all(updatePromises);
            
            return {
                success: true,
                updatedCount: updatedClientTickets.length,
                message: `Successfully updated ${updatedClientTickets.length} client tickets`
            };
        } catch (error) {
            throw error;
        }
    }

}
