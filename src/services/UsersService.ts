import { Request,Response} from "express";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";
import { UsersInfoEntity } from "../entity/UserInfo";
import { EntityManager, Like } from "typeorm";
import { UserApiKeyEntity } from "../entity/UserApiKey";
import { generateAPIKey } from "../helpers/helpers";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { MobileUsersEntity } from "../entity/MoblieUsers";
import bcrypt from "bcryptjs";
import { supabaseAdmin } from "../utils/supabase";
import { Issue } from "../entity/Issue";
import { ActionItems } from "../entity/ActionItems";
import { ClientTicket } from "../entity/ClientTicket";
import { tagIds } from "../constant";
import { ListingService } from "./ListingService";
import { format } from "date-fns";
import { LiveIssue } from "../entity/LiveIssue";
import { AssignedTask } from "../entity/AssignedTask";


interface ApiKey {
    apiKey: String;
}
export class UsersService {

    private usersRepository = appDatabase.getRepository(UsersEntity);
    private userInfoRepository = appDatabase.getRepository(UsersInfoEntity);
    private userApiKeyRepository = appDatabase.getRepository(UserApiKeyEntity);
    private hostAwayClient = new HostAwayClient();
    private connectedAccountServices = new ConnectedAccountService();
    private mobileUser = appDatabase.getRepository(MobileUsersEntity)

    private issuesRepository = appDatabase.getRepository(Issue);
    private actionItemsRepo = appDatabase.getRepository(ActionItems);
    private clientTicketRepo = appDatabase.getRepository(ClientTicket);
    private liveIssuesRepo = appDatabase.getRepository(LiveIssue);
    private assignedTaskRepo = appDatabase.getRepository(AssignedTask);


    async createUser(request: Request, response: Response) {
        const userData =(request.body);
        // console.log("userData",userData);

        try {

            const checkExistingUser = await this.usersRepository.findOne({
                where: {
                    email: userData?.email,
                }
            });

            if (checkExistingUser) {
                return response.status(409).json({
                    message: 'Email has been already used!!!'
                });
            }

            const savedData = await this.usersRepository.save(userData);
            // console.log("savedData", savedData);

            return response.status(200).json({
                message: 'User created successfully',
                data: savedData,
            });
            
        } catch (error) {
            console.log("error",error);
            throw error;
        }
    }


    async checkUserForGoogleLogin(email: string, uid: string) {
        const isExist = await this.usersRepository.findOne({
            where: {
                email: email,
                uid: uid
            }
        });

        if (!isExist) {
            return false;
        } else {
            return true;
        }
    }

    async checkUserEmail(email: string) {
        const isExist = await this.usersRepository.findOne({
            where: {
                email: email
            }
        });

        if (!isExist) {
            return {
                success: false,
                message: 'Please provide valid user!!!'
            };
        }

        return {
            success: true,
            message: 'Valid user!!!'
        };
    }


    async googleLoginSingUp(userData: object) {

        const data = await this.usersRepository.save(userData);
        return data;
    }


    async createNewUser(request: Request) {

        try {
            const data: any = request.body;

            if (!data.fullName || !data.email || !data.userType) return {
                status: true,
                message: "Provide all required values!!!"
            };

            await this.userInfoRepository.save(data);

            return {
                status: true,
                message: "User created successfully!!!"
            };

        } catch (error) {
            throw new Error(error);
        }

    }

    async updateUser(request: Request) {

        const data: any = request.body;
        const userId: number = Number(data.userId);

        try {

            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) {
                return {
                    status: true,
                    message: `User not found for update!!!`
                };
            }

            await this.userInfoRepository.update(userId, data);
            return {
                status: true,
                message: 'Data updated Successfully!!!'
            };

        } catch (error) {
            throw error;
        }
    }



    async getUserList(request: Request) {

        const page: any = request.query.page || 1;
        const limit: any = request.query.limit || 10;
        const fullName: any = request.query.fullName || '';
        const offset: any = (page - 1) * limit;

        try {

            if (!page || !limit) return {
                status: true,
                message: "Provide page and limit!!!"
            };

            const userInfo = await this.userInfoRepository.findAndCount({
                where: {
                    fullName: Like(`%${fullName}%`),
                    isActive: true
                },
                take: limit,
                skip: offset,
                order: {
                    userId: "DESC"
                }
            });

            const totalCount = await this.userInfoRepository.count({
                where: {
                    isActive: true
                }
            });

            return {
                status: true,
                data: [
                    userInfo[0],
                    totalCount
                ]

            };

        } catch (error) {
            throw new Error(error);
        }
    }

    async getSingleUser(request: Request) {

        const userId: any = (request.query.userId);

        if (!userId) return {
            status: true,
            message: "Provide user id!!!"
        };

        try {


            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) return {
                status: true,
                message: "User not found!!!"
            };

            return {
                status: true,
                message: "Data found successfully!!!",
                data: user
            };

        } catch (error) {
            throw new Error(error);
        }
    }

    async deleteUser(request: Request) {

        const userId: any = request.query.userId;

        try {

            if (!userId) return {
                status: true,
                message: "Provide user!!!"
            };

            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) {
                return {
                    status: true,
                    message: "No user found to delete!!!"
                };
            }

            await this.userInfoRepository.update(userId, { isActive: false, });
            return {
                status: true,
                message: 'Data deleted Successfully!!!'
            };

        } catch (error) {
            throw new Error(error);
        }
    }


    async updateUserStatus(request: Request) {

        const userId: any = request.query.userId;
        const status: any = request.query.status;

        try {

            if (!userId) {
                return {
                    status: true,
                    message: "Please provide user!!!"
                };
            }

            const user = await this.userInfoRepository.findOne({
                where: {
                    userId: userId,
                    isActive: true
                }
            });

            if (!user) return {
                status: true,
                message: "User not found!!!"
            };

            const data = await this.userInfoRepository.update(userId, { status: status == 1 ? 0 : 1 });

            if (data.affected == 1) return {
                status: true,
                message: "User updated successfully!!!"
            };

            return {
                status: false,
                message: "Couldn't update status!!!"
            };



        } catch (error) {
            throw new Error(error);

        }
    };

    async updateMultipleUserStatus(request: Request) {
        const { userIds, userStatus } = request.body;

        try {

            if (Array.isArray(userIds)) {
                await appDatabase.transaction(async (updateUserTransaction: EntityManager) => {
                    await Promise.all(userIds?.map(async (user) => {
                        await updateUserTransaction.update(UsersInfoEntity, user, { status: userStatus });
                    }));

                });

                return {
                    status: true,
                    message: "User status updated successfully!!!"
                };
            } else {

                return {
                    status: true,
                    message: 'Please provide ids in array!!!'
                };
            }


        } catch (error) {
            throw new Error(error);
        }
    }

    async deleteMultipleUser(request: Request) {

        const userIds: any = request.body;

        try {

            if (!Array.isArray(userIds)) {

                return {
                    status: true,
                    message: "Provide data in array!!!"
                };
            }

            await Promise.all(userIds?.map(async (id) => {
                await this.userInfoRepository.update(id, { isActive: false });
            }));

            return {
                status: true,
                message: "Data deleted successfully!!!"
            };

        } catch (error) {
            throw new Error(error);
        }
    }

    async getApiKey(userId: string): Promise<ApiKey> {
        try {
            const apiKey = await this.userApiKeyRepository.findOne({ where: { userId, isActive: true } });
            if (!apiKey) {
                //create a new api key and return it
                return await this.generateApiKey(userId);
            }
            return { apiKey: apiKey.apiKey };
        } catch (error) {
            throw new Error(error);
        }
    }

    async generateApiKey(userId: string): Promise<ApiKey> {
        try {
            const newApiKey = generateAPIKey();
            const apiKey = await this.userApiKeyRepository.save({ userId, apiKey: newApiKey });
            return { apiKey: apiKey.apiKey };
        } catch (error) {
            throw new Error(error);
        }
    }

    async getHostawayUsersList(userId: string) {

        const { clientId, clientSecret } = await this.connectedAccountServices.getPmAccountInfo(userId);
        const hostawayUsersList = await this.hostAwayClient.getUserList(clientId, clientSecret);
        const users = hostawayUsersList.map(({ email, firstName, id, lastName }) => ({
            hostawayId: id,
            user: `${firstName}${lastName ? ' ' + lastName : ""} [${email}]`,
            email: email,
            firstName,
            lastName,
        }));
        return users;
    }

    async signUpUserInSupabase(email: string, firstName: string, lastName: string, password: string) {

        const user = await supabaseAdmin.auth.admin.createUser({
            email,
            password,
            email_confirm: true,
            user_metadata: {
                firstName,
                lastName,
                userType: 'mobileUser',
            },
        });

        return user;

    }

    async createMobileUser(userInfo: {
        hostawayId: number;
        revenueSharing: number;
        firstName: string;
        lastName: string | null;
        email: string;
        password: string;
    }, userId: string) {
        const { email, hostawayId, firstName, lastName, password, revenueSharing } = userInfo;

        //hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        //check if user already exists
        const existingUser = await this.mobileUser.findOne({ where: { email } });
        if (existingUser) {
            return {
                status: false,
                message: "User with this email already exists!!!",
            };
        }

        const userData = {
            hostawayId,
            firstName,
            lastName,
            email,
            password: hashedPassword,
            revenueSharing,
            user_id: userId
        };

        const user = await this.mobileUser.save(userData);

        if (user) {
            return {
                status: true,
                message: "User created successfully!!!",
            };
        }
    }

    async getMobileUsers(request: Request) {
        const page = Number(request.query.page) || 1;
        const limit = Number(request.query.limit) || 10;
        const skip = (page - 1) * limit;
        const email = typeof request.query.email === 'string' ? request.query.email : '';

        const users = await this.mobileUser.find({
            select: [
                'id',
                'hostawayId',
                'firstName',
                'lastName',
                'email',
                'revenueSharing'
            ],
            where: email ? { email } : undefined,
            order: { id: 'DESC' },
            skip: skip,
            take: limit,
        });

        const transformedUsers = users.map(user => {
            const username = user.lastName
                ? `${user.firstName}.${user.lastName}`
                : user.firstName;

            return {
                ...user,
                username,
            };
        });

        return {
            status: transformedUsers.length > 0,
            message: transformedUsers.length > 0 ? "Users retrieved successfully" : "Data not found!!!",
            data: transformedUsers
        };
    }


    async updateMobileUser(userInfo: {
        id: number;
        hostawayId?: number;
        revenueSharing?: number;
        firstName?: string;
        lastName?: string | null;
        email?: string;
        password?: string;
    }, updatedBy: string, id: string) {
        const { password, ...updateData } = userInfo;

        // Find the existing user
        const existingUser = await this.mobileUser.findOne({ where: { id: Number(id) } });
        if (!existingUser) {
            return {
                status: false,
                message: "User not found!!!",
            };
        }

        // If password is provided, hash it and update password-related fields
        if (password) {
            const hashedPassword = await bcrypt.hash(password, 10);
            updateData['password'] = hashedPassword;
            updateData['lastPasswordChangedAt'] = new Date();
            updateData['lastPasswordChangedBy'] = updatedBy;
        }

        // Update the user with new data
        const updatedUser = await this.mobileUser.update(id, {
            ...updateData,
            updatedBy,
            updatedAt: new Date()
        });

        if (updatedUser.affected === 1) {
            return {
                status: true,
                message: "User updated successfully!!!",
            };
        }

        return {
            status: false,
            message: "Failed to update user!!!",
        };
    }

    async fetchUserList() {
        return await this.usersRepository
            .createQueryBuilder("user")
            .select("user.uid", "uid")
            .addSelect("CONCAT(user.firstName, ' ', user.lastName)", "name")
            .where("user.isActive = :isActive", { isActive: true })
            .getRawMany();
    }

    async fetchPaginatedUserList(filter: any) {
        const { page, limit } = filter;
        const offset = (page - 1) * limit;

        const [data, total] = await this.usersRepository.findAndCount({
            where: { deletedAt: null },
            order: { createdAt: "DESC" },
            skip: offset,
            take: limit,
        });

        return { data, total };
    }

    async removeUser(uid: string, userId: string) {
        await supabaseAdmin.auth.admin.deleteUser(uid, true);
        const connectedAccountService = new ConnectedAccountService();
        await connectedAccountService.deleteConnectedAccount(uid);
        return await this.usersRepository.update({ uid }, { deletedAt: new Date(), deletedBy: userId });
    }


    async getAssignedTaskInfo(userId: string) {
        //Issues
        const issues = await this.issuesRepository.find({
            where: {
                assignee: userId
            },
            relations: ["issueUpdates"],
            order: { urgency: "DESC" }
        });

        //Action Items
        const actionItems = await this.actionItemsRepo.find({
            where: {
                assignee: userId
            },
            relations: ["actionItemsUpdates"],
            order: { urgency: "DESC" }
        });

        //Client Tickets
        const clientTickets = await this.clientTicketRepo.find({
            where: {
                assignee: userId
            },
            relations: ["clientTicketUpdates"],
            order: { urgency: "DESC" },
        });

        //Live Issues
        const liveIssues = await this.liveIssuesRepo.find({
            where: {
                assignee: userId
            },
            relations: ["liveIssueUpdates"],
            order: { followUp: "DESC" },
        })

        // Assigned Tasks (HR Management - Personal)
        const assignedTasks = await this.assignedTaskRepo.find({
            where: {
                assignee: { uid: userId }
            },
            relations: ["updates"],
            order: { createdAt: "DESC" }
        });

        const users = await this.usersRepository.find();
        const userMap = new Map(users.map(user => [user.uid, `${user?.firstName}`]));

        const listingService = new ListingService();
        const listings = await listingService.getListingNames(userId);

        const transformedClientTickets = clientTickets.map(ticket => {
            return {
                id: ticket.id,
                status: ticket.status,
                assignee: ticket.assignee,
                assigneeName: userMap.get(ticket.assignee) || ticket.assignee,
                area: "Client Ticket",
                property: listings.find((listing) => listing.id == Number(ticket.listingId))?.internalListingName || ticket.listingId,
                description: ticket.description,
                latestUpdate: ticket.clientTicketUpdates.sort((a, b) => b.id - a.id)[0]?.updates || '',
                urgency: ticket.urgency,
                mistake: ticket.mistake,
                mistakeResolvedOn: ticket.mistakeResolvedOn,
                createdAt: ticket.createdAt,
                completedOn: ticket.completedOn
            };
        });

        const transformedActionItems = actionItems.map(item => {
            return {
                id: item.id,
                status: item.status,
                assignee: item.assignee,
                assigneeName: userMap.get(item.assignee) || item.assignee,
                area: "Action Item",
                property: listings.find((listing) => listing.id == Number(item.listingId))?.internalListingName || item.listingId,
                description: item.item,
                latestUpdate: item.actionItemsUpdates.sort((a, b) => b.id - a.id)[0]?.updates || '',
                urgency: item.urgency,
                mistake: item.mistake,
                mistakeResolvedOn: item.mistakeResolvedOn,
                createdAt: item.createdAt,
                completedOn: item.completedOn
            };
        });

        const transformedIssues = issues.map(issue => {
            return {
                id: issue.id,
                status: issue.status,
                assignee: issue.assignee,
                assigneeName: userMap.get(issue.assignee) || issue.assignee,
                area: "Issues",
                property: issue.listing_name || issue.listing_id,
                description: issue.issue_description,
                latestUpdate: issue.issueUpdates.sort((a, b) => b.id - a.id)[0]?.updates || '',
                urgency: issue.urgency,
                mistake: issue.mistake,
                mistakeResolvedOn: issue.mistakeResolvedOn,
                createdAt: issue.created_at,
                completedOn: issue.completed_at
            };
        });


        const transformedLiveIssues = liveIssues.map(issue => {
            return {
                id: issue.id,
                status: issue.status,
                assignee: issue.assignee,
                assigneeName: userMap.get(issue.assignee) || issue.assignee,
                area: "Live Issues",
                property: listings.find((listing) => listing.id == Number(issue.propertyId))?.internalListingName || issue.propertyId,
                description: issue.summary,
                latestUpdate: issue.liveIssueUpdates.sort((a, b) => b.id - a.id)[0]?.updates || '',
                urgency: 0,
                mistake: null,
                mistakeResolvedOn: null,
                createdAt: issue.createdAt,
                completedOn: ""
            };

        });

        const transformedAssignedTasks = assignedTasks.map(task => {
            return {
                id: task.id,
                status: task.status,
                assignee: task.assignee?.uid, // Using relation uid
                assigneeName: userMap.get(task.assignee?.uid) || task.assignee?.uid,
                area: task.taskType || "Personal", // Or use strict Personal
                property: "Internal",
                description: task.title,
                latestUpdate: task.updates?.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.content || '',
                urgency: 10, // Max urgency to float near top, but area takes precedence essentially
                mistake: null,
                mistakeResolvedOn: null,
                createdAt: task.createdAt,
                completedOn: task.status === 'Completed' ? new Date().toISOString() : "" // Mocking completion for simplistic count
            };
        });

        const data = [
            ...transformedAssignedTasks,
            ...transformedActionItems, 
            ...transformedClientTickets, 
            ...transformedIssues,
            ...transformedLiveIssues
        ].sort((a, b) => {
            // Force Personal/Internal tasks to the absolute top
            if (a.area === 'Personal' || a.area === 'Internal') return -1;
            if (b.area === 'Personal' || b.area === 'Internal') return 1;
            // Native sorting handles the rest
            return b.urgency - a.urgency || (new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) || (a.mistake && !b.mistake ? -1 : !a.mistake && b.mistake ? 1 : 0);
        });

        const taggedDataCount = {
            active: data.filter(item => item.status && !['completed', 'resolved', 'closed'].some(s => item.status.toLowerCase().includes(s))).length,
            new: data.filter(item => item.status && ["new", "pending"].includes(item.status.toLowerCase())).length,
            inProgress: data.filter(item => item.status && item.status.toLowerCase() === "in progress").length,
            needHelp: data.filter(item => item.status && item.status.toLowerCase() === "need help").length,
            completedToday: data.filter(item => item.completedOn && format(new Date(item.completedOn), "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd")).length,
        };


        const mistakeCount = {
            total: data.filter(item => item.mistake && item.mistake.toLowerCase() !== "resolved").length || 0,
            new: data.filter(item => item.mistake && item.mistake.toLowerCase() === "yes").length,
            inProgress: data.filter(item => item.mistake && item.mistake.toLowerCase() === "in progress").length,
            needHelp: data.filter(item => item.mistake && item.mistake.toLowerCase() === "need help").length,
            completedToday: data.filter(item => item.mistake && item.mistake.toLowerCase() === "resolved" && item.mistakeResolvedOn === format(new Date(), "yyyy-MM-dd")).length,
            overall: data.filter(item => item.mistake).length
        };

        return { data, taggedDataCount, mistakeCount };
    }


}


