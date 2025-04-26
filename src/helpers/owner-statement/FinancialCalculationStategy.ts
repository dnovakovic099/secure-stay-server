export interface FinancialCalculationStrategy {
    appliesTo(reservationDate: string): boolean;
    calculate(
        reservation: any,
        financeStandardField: any,
        options: {
            clientId: string;
            clientSecret: string;
            pmFee: number;
            isClaimProtection: boolean;
            hidePetFee: boolean;
        }
    ): Promise<{
        ownerPayout: number;
        pmCommission: number;
        paymentProcessing: number;
        channelFee: number;
        totalTax: number;
        revenue: number;
        payout: number;
        managementFee: number;
    }>;
}