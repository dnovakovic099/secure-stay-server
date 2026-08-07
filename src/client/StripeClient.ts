import Stripe from "stripe";
import {filterValidURLs} from "../utils/url.util";


export class StripeClient {

    private stripe =
        new Stripe(process.env.STRIPE_CLIENT_SECRET);


    async pay(currency: string, name: string, price: number, images: string[] = [],
              successUrl: string, cancelUrl: string) {
        images = filterValidURLs(images);
        const lineItem = {
            price_data: {
                currency: currency,
                product_data: {
                    name: name,
                    images: images
                },
                unit_amount: Math.round(price * 100),
            },
            quantity: 1
        }

        const session = await this.stripe.checkout.sessions.create(
            {
                payment_method_types: ["card"],
                line_items: [lineItem],
                mode: "payment",
                client_reference_id: name,
                success_url: successUrl,
                cancel_url: cancelUrl
            }
        )

        return session.id;
    }

    /**
     * Create a Stripe Checkout Session for an upsell Request & Order.
     * Returns the session id + hosted URL for payment_link storage.
     */
    async createUpsellCheckoutSession(input: {
        name: string;
        price: number;
        currency?: string;
        successUrl: string;
        cancelUrl: string;
        clientReferenceId?: string;
        metadata?: Record<string, string>;
    }): Promise<{ id: string; url: string | null }> {
        const currency = (input.currency || "usd").toLowerCase();
        const session = await this.stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [{
                price_data: {
                    currency,
                    product_data: { name: input.name },
                    unit_amount: Math.round(Math.max(0, Number(input.price) || 0) * 100),
                },
                quantity: 1,
            }],
            mode: "payment",
            client_reference_id: input.clientReferenceId || input.name,
            success_url: input.successUrl,
            cancel_url: input.cancelUrl,
            metadata: input.metadata || {},
        });
        return { id: session.id, url: session.url };
    }


     verifyDataIntegrity(data: any, sig): Stripe.Event {
        let event;
        try {
            event = this.stripe.webhooks.constructEvent(data, sig, process.env.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            console.log(err.message)
            throw new Error("StripeClient: Fail data validation:  " + err.message)
        }
        return event;
    }

    async getChargeById(chargeId: string): Promise<Stripe.Charge> {
        return this.stripe.charges.retrieve(chargeId);
    }
}