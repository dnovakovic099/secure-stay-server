import {Request,Response} from "express";
import { UsersService } from "../services/UsersService";

export class UsersController{

    async createUser(request:Request,response:Response) {
            const usersService = new UsersService();
        return response.send(await usersService.createUser(request,response));
    }
}
