import Stripe from "stripe";
import { UserSubscriptionInfo } from "../entity/UserSubscriptionInfo";
import { appDatabase } from "../utils/database.util";
import { UserSubscriptionCheckoutSession } from "../entity/UserSubscriptionCheckoutSession";
import moment from "moment";
import CustomErrorHandler from "../middleware/customError.middleware";

export class UserSubscriptionService {
  private userSubscriptionInfoRepo =
    appDatabase.getRepository(UserSubscriptionInfo);
  private userSubscriptionCheckoutSession = appDatabase.getRepository(
    UserSubscriptionCheckoutSession
  );
  private stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  private async createCheckoutSession(planId: string) {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: planId,
          quantity: 1,
        },
      ],
      success_url: "http://localhost:3000/subscription/success",
      cancel_url: "http://localhost:3000/subscription/cancel",
    });

    return session;
  }

  async createUserSubscriptionCheckoutSession(planId: string, userId: string) {
    const session = await this.createCheckoutSession(planId);

    const checkoutSession = await this.userSubscriptionCheckoutSession.findOne({
      where: { userId },
    });

    if (checkoutSession) {
      checkoutSession.sessionId = session.id;
      checkoutSession.updated_at = new Date();
      await this.userSubscriptionCheckoutSession.save(checkoutSession);
    } else {
      const checkoutSessionInfo = new UserSubscriptionCheckoutSession();
      checkoutSessionInfo.sessionId = session.id;
      checkoutSessionInfo.userId = userId;
      checkoutSessionInfo.created_at = new Date();
      checkoutSessionInfo.updated_at = new Date();
      await this.userSubscriptionCheckoutSession.save(checkoutSessionInfo);
    }

    return session;
  }

  async saveUserSubscriptionInfo(userId: string) {
    const sessionInfo = await this.userSubscriptionCheckoutSession.findOne({
      where: { userId },
    });
    const session = await this.stripe.checkout.sessions.retrieve(
      sessionInfo.sessionId
    );

    if (session.payment_status === "paid") {
      const subscriptionId = session.subscription as string;

      const subscription = await this.stripe.subscriptions.retrieve(
        subscriptionId
      );

      const userSubscriptionInfo = new UserSubscriptionInfo();
      userSubscriptionInfo.subscriptionId = subscriptionId;
      userSubscriptionInfo.customerId = subscription.customer as string;
      userSubscriptionInfo.planId = subscription.items.data[0].plan.id;
      userSubscriptionInfo.userId = userId;
      userSubscriptionInfo.startDate = moment
        .unix(subscription.current_period_start)
        .format("YYYY-MM-DD");
      userSubscriptionInfo.endDate = moment
        .unix(subscription.current_period_end)
        .format("YYYY-MM-DD");
      const durationInSeconds =
        subscription.current_period_end - subscription.current_period_start;
      userSubscriptionInfo.durationInDays = moment
        .duration(durationInSeconds, "seconds")
        .asDays();
      userSubscriptionInfo.created_at = new Date();
      userSubscriptionInfo.updated_at = new Date();

      await this.userSubscriptionInfoRepo
        .save(userSubscriptionInfo)
        .then(async () => {
          await this.userSubscriptionCheckoutSession.delete({ userId });
        });
    }
    return;
  }

  async getUserSubscriptionInfo(userId: string): Promise<object> {
    const userSubscription = await this.userSubscriptionInfoRepo.findOne({
      where: { userId },
    });
    if (!userSubscription) {
      return {
        isExpired: true,
        subscription: null,
        price: null,
      };
    }

    const currentDate = moment();
    const endDate = moment(userSubscription.endDate);

    const price = await this.stripe.prices.retrieve(userSubscription.planId);
    const product = await this.stripe.products.retrieve(
      price.product as string
    );

    return {
      isExpired: currentDate.isAfter(endDate),
      subscription: userSubscription,
      product: product,
      price: price,
    };
  }

  async getUserInvoices(userId: string) {
    const userSubscription = await this.userSubscriptionInfoRepo.findOne({
      where: { userId },
    });
    if (!userSubscription) {
      throw CustomErrorHandler.notFound("Subscription not found");
    }

    const invoices = await this.stripe.invoices.list({
      customer: userSubscription.customerId,
    });
    const upcoming_invoice = await this.stripe.invoices.retrieveUpcoming({
      customer: userSubscription.customerId,
    });

    if (!invoices) {
      throw CustomErrorHandler.notFound("Invoice not found");
    }

    const result = [];
    const paidInvoices = invoices.data.filter((invoice) => invoice.paid);
    paidInvoices.forEach((invoice) => {
      result.push({
        paid_at: moment
          .unix(invoice.status_transitions.paid_at)
          .format("MMMM D, YYYY"),
        amount: invoice.amount_paid / 100,
        currency: invoice.currency,
        hosted_invoice_url: invoice.hosted_invoice_url,
        invoice_pdf: invoice.invoice_pdf,
        paid: invoice.paid,
      });
    });

    const upcomingInvoiceObj = {
      created_at: moment.unix(upcoming_invoice.created).format("MMMM D, YYYY"),
      amount: upcoming_invoice.amount_due / 100,
      currency: upcoming_invoice.currency,
      hosted_invoice_url: upcoming_invoice.hosted_invoice_url,
      invoice_pdf: upcoming_invoice.invoice_pdf,
      paid: upcoming_invoice.paid,
    };

    return [{ invoices: result, upcomingInvoice: upcomingInvoiceObj }];
  }
}
