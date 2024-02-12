import {Request,Response} from "express";
import {PaymentService} from "../services/PaymentService";

export class PaymentController{

    async payReservation(request:Request,response:Response){
        const paymentService = new PaymentService();
        return response.send(await paymentService.payReservation(request))
    }


    async payItem(request:Request,response:Response){
        const paymentService = new PaymentService();
        return response.send(await paymentService.payItem(request))
    }


    async verifyPayment(request:Request, response: Response) {
        const paymentService = new PaymentService();
        return response.send(await paymentService.verifyPayment(request))
    }
}