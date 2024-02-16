import { Request,Response} from "express";
import { appDatabase } from "../utils/database.util";
import { UsersEntity } from "../entity/Users";

export class UsersService {

    private usersRepository = appDatabase
        .getRepository(UsersEntity);
  
    async createUser(request: Request, response: Response) {
        const userData =(request.body);
        console.log("userData",userData);

        try {
            const savedData = await this.usersRepository.save(userData);
            console.log("savedData", savedData);

            return response.status(200).json({
                message: 'User created successfully',
                data: savedData,
            });
            
        } catch (error) {
            console.error('Error saving user:', error);
            return 'Internal Server Error';
        }
    }
}


