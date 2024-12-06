import { NextFunction, Request, Response } from "express";
import { UsersService } from "../services/UsersService";

interface CustomRequest extends Request {
    user?: any;
}
export class UsersController{

    async createUser(request:Request,response:Response) {
            const usersService = new UsersService();
        return response.send(await usersService.createUser(request,response));
    }

    async checkUserForGoogleLogin(request: Request, response: Response, next: NextFunction) {
        try {
            const usersService = new UsersService();

            const email: string = request.query.email.toString();
            const uid: string = request.query.uid.toString();

            const data = await usersService.checkUserForGoogleLogin(email, uid);

            return response.status(200).json({
                success: data
            });

        } catch (error) {

            return next(error);
        }
    }

    async googleSignup(request: Request, response: Response, next: NextFunction) {
        try {
            const userData = request.body;

            const usersService = new UsersService();
            await usersService.googleLoginSingUp(userData);

        } catch (error) {

        }
    }

    async checkUserEmail(request: Request, response: Response, next: NextFunction) {
        try {
            const usersService = new UsersService();

            const email: string = request.query.email.toString();

            const data = await usersService.checkUserEmail(email);

            return response.status(200).json(data);

        } catch (error) {

            return next(error);
        }
    }

    async createNewUser(request: Request, response: Response) {
        console.log(request.body);

        const createUserService = new UsersService();
        return response.send(await createUserService.createNewUser(request));

    }

    async updateUser(request: Request, response: Response) {

        const updateService = new UsersService();
        return response.send(await updateService.updateUser(request));

    }

    async deleteUser(request: Request, response: Response) {

        const deleteService = new UsersService();
        return response.send(await deleteService.deleteUser(request));

    }

    async getSingleUser(request: Request, response: Response) {

        const singleUserService = new UsersService();
        return response.send(await singleUserService.getSingleUser(request));

    }

    async getUserList(request: Request, response: Response) {

        const userListService = new UsersService();
        return response.send(await userListService.getUserList(request));

    }

    async deleteMultipleUser(request: Request, response: Response) {

        const deleteMultipleUserService = new UsersService();
        return response.send(await deleteMultipleUserService.deleteMultipleUser(request));

    }

    async updateUserStatus(request: Request, response: Response) {
        const updateUserStatusService = new UsersService();
        return response.send(await updateUserStatusService.updateUserStatus(request));
    }

    async updateMultipleUserStatus(request: Request, response: Response) {
        const multipleUserStatusService = new UsersService();
        return response.send(await multipleUserStatusService.updateMultipleUserStatus(request));
    }

    async getApiKey(request: CustomRequest, response: Response) {
        const usersService = new UsersService();
        const userId = request.user.id;
        return response.send(await usersService.getApiKey(userId));
    }

    async getHostawayUsersList(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const usersService = new UsersService();
            const userId = request.user.id;
            return response.send(await usersService.getHostawayUsersList(userId));
        } catch (error) {
            return next(error);
        }
    };

    async createMobileUser(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const usersService = new UsersService();
            return response.send(await usersService.createMobileUser(request.body));
        } catch (error) {
            return next(error);
        }
    }

    async getMobileUsersList(request: CustomRequest, response: Response, next: NextFunction) {
        try {
            const usersService = new UsersService();
            return response.send(await usersService.getMobileUsers(request));
        } catch (error) {
            return next(error);
        }
    };
}

