import { Between, In } from "typeorm";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { appDatabase } from "../utils/database.util";
import CustomErrorHandler from "../middleware/customError.middleware";
import { UsersEntity } from "../entity/Users";

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
}


export class ClientTicketService {
    private clientTicketRepo = appDatabase.getRepository(ClientTicket);
    private clientTicketUpdateRepo = appDatabase.getRepository(ClientTicketUpdates);
    private usersRepo = appDatabase.getRepository(UsersEntity)


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

    public async saveClientTicketWithUpdates(body: any, userId: string) {
        const { latestUpdates } = body;
        const ticketData: Partial<ClientTicket> = {
            status: body.status,
            listingId: body.listingId,
            category: JSON.stringify(body.category),
            description: body.description,
            resolution: body.resolution,
        };
        const clientTicket = await this.createClientTicket(ticketData, userId);
        latestUpdates && await this.createClientTicketUpdates(clientTicket, latestUpdates, userId);
        return clientTicket;
    }

    public async getClientTicket(body: ClientTicketFilter) {
        const { status, listingId, category, fromDate, toDate, page, limit } = body;

        const users = await this.usersRepo.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName} ${user?.lastName}`]));

        const [clientTickets, total] = await this.clientTicketRepo.findAndCount({
            where: {
                ...(status && status.length > 0 && { status: In(status) }),
                ...(listingId && listingId.length > 0 && { listingId: In(listingId) }),
                ...(category && category.length > 0 && { category: In(category) }),
                ...(fromDate && toDate && { createdAt: Between(new Date(fromDate), new Date(toDate)) }),
            },
            relations: ["clientTicketUpdates"],
            skip: (page - 1) * limit,
            take: limit,
        });

        const transformedTickets = clientTickets.map(ticket => {
            return {
                ...ticket,
                createdBy: userMap.get(ticket.createdBy) || ticket.createdBy,
                clientTicketUpdates: ticket.clientTicketUpdates.map(update => ({
                    ...update,
                    createdBy: userMap.get(update.createdBy) || update.createdBy,
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
        return clientTicket;
    }

}
