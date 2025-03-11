import {Request} from "express";
import Stripe from 'stripe';
import {appDatabase} from "../utils/database.util";
import {ReservationEntity} from "../entity/Reservation";
import {PaymentEntity} from "../entity/Payment";
import {HostAwayClient} from "../client/HostAwayClient";
import {Item} from "../entity/Item";
import {filterValidURLs, removeAkiPolicy} from "../utils/url.util";
import {StripeClient} from "../client/StripeClient";


export class PaymentService {

    private reservationRepository = appDatabase
        .getRepository(ReservationEntity);

    private paymentRepository = appDatabase
        .getRepository(PaymentEntity);

    private itemRepository = appDatabase
        .getRepository(Item);

    private hostAwayClient = new HostAwayClient();

    private stripeClient = new StripeClient();


    async verifyPayment(request: Request) {
        const sig = request.headers['stripe-signature'];
        const event = this.stripeClient.verifyDataIntegrity(request.body,sig);
        switch (event.type) {
            case 'checkout.session.completed':
                const checkoutSession = event.data.object;
                const idRegex = /\/([\w-]+)$/;
                const reservationLink = checkoutSession.success_url.match(idRegex)[1];
                const reservation = await this.reservationRepository
                    .findOne({where: {reservationLink}});
                const payment = new PaymentEntity();
                payment.paymentDate = new Date();
                payment.currency = checkoutSession.currency;
                payment.value = checkoutSession.amount_total;
                payment.reservation = reservation;
                payment.name = checkoutSession.client_reference_id;
                this.paymentRepository.save(payment);
                break;
            default:
                console.log(`Unhandled event type ${event.type}`);
        }

    }

    async payItem(request: Request) {
        const item_id = Number(request.params.itemId);
        const reservationLink = String(request.params.reservationLink);
        const item = await this.itemRepository
            .findOne({where: {item_id}});
        if(item === null){
            throw new Error("PaymentService: Item is null");
        }
        if(reservationLink === null){
            throw new Error("PaymentService: reservationLink is null");
        }
        return this.stripeClient.pay(item.currency,item.item_name,item.item_price,[item.photo_url],
            `${process.env.FRONTEND_URL}${reservationLink}`,
            `${process.env.FRONTEND_URL}${reservationLink}`)
    }

    // async payReservation(request: Request) {
    //     const reservationLink = String(request.params.reservationLink);
    //     const reservation = await this.reservationRepository
    //         .findOne({where: {reservationLink}});
    //     const data = await this.hostAwayClient.getListingInfo(reservation?.reservationInfo?.listingMapId);
    //     const propertyInfo = await data?.result;
    //     if(reservationLink === null){
    //         throw new Error("PaymentService: reservationLink is null");
    //     }
    //     if(propertyInfo === null){
    //         throw new Error("PaymentService: Property info is null")
    //     }
    //     if(reservation === null){
    //         throw new Error("PaymentService: Reservation is null")
    //     }
    //     return this.stripeClient.pay(reservation?.reservationInfo?.currency, propertyInfo?.name, reservation?.reservationInfo?.totalPrice,
    //         [removeAkiPolicy(propertyInfo?.thumbnailUrl)],
    //         `${process.env.FRONTEND_URL}${reservationLink}`, `${process.env.FRONTEND_URL}${reservationLink}`
    //     )
    // }




}