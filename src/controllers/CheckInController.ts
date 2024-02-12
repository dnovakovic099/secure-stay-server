import {Request,Response} from "express";
import {CheckInService} from "../services/CheckInService";

export class CheckInController{

    async getAllByReservationLink(request:Request, response:Response){
        const checkInService = new CheckInService();
        return response.send(await checkInService.getAllByReservation(request));
    }

    async checkIn(request:Request,response:Response) {
            const checkInService = new CheckInService();
        return response.send(await checkInService.checkIn(request));
    }
}