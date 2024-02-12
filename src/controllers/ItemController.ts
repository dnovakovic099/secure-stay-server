import {Request,Response} from "express";
import {ItemService} from "../services/ItemService";

export class ItemController{

    async getAllItemsByReservation(request:Request,response:Response){
        const itemService = new ItemService();
        return response.send(await itemService.getAllItemByReservation(request));
    }

}