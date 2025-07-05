import { Between, In } from "typeorm";
import { ClientTicket } from "../entity/ClientTicket";
import { ClientTicketUpdates } from "../entity/ClientTicketUpdates";
import { appDatabase } from "../utils/database.util";
import CustomErrorHandler from "../middleware/customError.middleware";
import { UsersEntity } from "../entity/Users";
import { buildClientTicketSlackMessage } from "../utils/slackMessageBuilder";
import sendSlackMessage from "../utils/sendSlackMsg";
import { SlackMessageService } from "./SlackMessageService";
import logger from "../utils/logger.utils";
import { Listing } from "../entity/Listing";

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
    private usersRepo = appDatabase.getRepository(UsersEntity);
    private listingRepo = appDatabase.getRepository(Listing);


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

        return await this.clientTicketUpdateRepo.save(newUpdate);
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
        await this.sendSlackMessage(clientTicket, userId);
        return clientTicket;
    }

    private async sendSlackMessage(ticket: ClientTicket, userId: string) {
        try {
            const userInfo = await this.usersRepo.findOne({ where: { uid: userId } });
            const user = userInfo ? `${userInfo.firstName} ${userInfo.lastName}` : "Unknown User";

            const listingInfo = await this.listingRepo.findOne({
                where: {
                    id: Number(ticket.listingId),
                    userId: userId
                }
            });

            const slackMessageService = new SlackMessageService();
            const slackMessage = buildClientTicketSlackMessage(ticket, user, listingInfo?.internalListingName);
            const slackResponse = await sendSlackMessage(slackMessage);

            await slackMessageService.saveSlackMessageInfo({
                channel: slackResponse.channel,
                messageTs: slackResponse.ts,
                threadTs: slackResponse.ts,
                entityType: "client_ticket",
                entityId: ticket.id,
                originalMessage: JSON.stringify(slackMessage)
            });
        } catch (error) {
            logger.error("Slack creation failed", error);
        }
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


    public async updateTicketUpdates(body: any, userId: string) {
        const { id, updates } = body;
        const ticketUpdates = await this.clientTicketUpdateRepo.findOne({ where: { id } });
        if (!ticketUpdates) {
            throw CustomErrorHandler.notFound(`Ticket update with ${id} not found.`);
        }

        ticketUpdates.updates = updates;
        ticketUpdates.updatedBy = userId;

        return await this.clientTicketUpdateRepo.save(ticketUpdates);
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

}
