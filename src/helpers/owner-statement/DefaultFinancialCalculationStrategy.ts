import { isSameOrAfterDate } from "../date";
import { FinancialCalculationStrategy } from "./FinancialCalculationStategy";

export class DefaultFinancialCalculationStrategy implements FinancialCalculationStrategy {
    appliesTo(reservationDate: string): boolean {
        return !isSameOrAfterDate(reservationDate, "2025-04-11");
    }

    async calculate(
        reservation: {
            channelId: number;
            cleaningFee: number;
        },
        financeStandardField: any,
        options: {
            pmFee: number;
            isClaimProtection: boolean;
            hidePetFee: boolean;
        }
    ) {
        const { pmFee, isClaimProtection, hidePetFee } = options;
        // Initialize financial variables
        let channelFee = 0;
        let airbnbPayoutSum = 0;
        let totalTax = 0;
        let directPayout = 0;
        let ownerPayout = 0;
        let paymentProcessing = 0;
        let pmCommission = 0;
        let subTotalPrice = 0;
        let claimsProtection = 0;
        let linenFeeAirbnb = 0;
        let insuranceFee = 0;
        let airbnbCommission = 0;
        let vrboCommission = 0;
        let resortFeeAirbnb = 0;
        let airbnbCleaningFeeIssue = false;

        if (reservation.cleaningFee != financeStandardField.cleaningFeeValue) {
            airbnbCleaningFeeIssue = true;
        }

        linenFeeAirbnb = financeStandardField?.linenFeeAirbnb || 0;
        insuranceFee = financeStandardField?.insuranceFee || 0;
        resortFeeAirbnb = financeStandardField?.resortFeeAirbnb || 0;

        // Calculate financial fields based on channelId
        if (reservation.channelId === 2018) {

            if (airbnbCleaningFeeIssue && linenFeeAirbnb == 0) {
                linenFeeAirbnb = financeStandardField.cleaningFeeValue - reservation.cleaningFee;
            }

            airbnbPayoutSum = financeStandardField.airbnbPayoutSum;
            claimsProtection = isClaimProtection ? ((airbnbPayoutSum + directPayout - linenFeeAirbnb) * (-0.1)) : 0;
            subTotalPrice = (airbnbPayoutSum + directPayout + claimsProtection - linenFeeAirbnb);
            airbnbCommission = (airbnbPayoutSum + claimsProtection - linenFeeAirbnb) * pmFee;
            pmCommission = (airbnbCommission + vrboCommission);
            ownerPayout = (subTotalPrice - pmCommission - channelFee - paymentProcessing);
        } else {
            channelFee = (financeStandardField.hostChannelFee);

            totalTax = [
                financeStandardField.vat,
                financeStandardField.hotelTax,
                financeStandardField.lodgingTax,
                financeStandardField.salesTax,
                financeStandardField.transientOccupancyTax,
                financeStandardField.cityTax,
                financeStandardField.roomTax,
                financeStandardField.otherTaxes,
            ].reduce((sum, tax) => sum + tax, 0);

            directPayout = [
                financeStandardField.baseRate,
                financeStandardField.cleaningFeeValue,
                totalTax,
                hidePetFee ? 0 : financeStandardField.petFee,
                financeStandardField.weeklyDiscount,
                financeStandardField.couponDiscount,
                financeStandardField.monthlyDiscount,
                financeStandardField.cancellationPayout,
                financeStandardField.otherFees,
            ].reduce((sum, field) => sum + field, 0);

            paymentProcessing = reservation.channelId == 2005 ? 0 : (directPayout * 0.03);
            claimsProtection = isClaimProtection ? ((airbnbPayoutSum + directPayout - linenFeeAirbnb) * (-0.1)) : 0;
            subTotalPrice = (airbnbPayoutSum + directPayout + claimsProtection - linenFeeAirbnb);
            vrboCommission = (directPayout + claimsProtection - channelFee - paymentProcessing) * pmFee;
            pmCommission = (airbnbCommission + vrboCommission);
            ownerPayout = (subTotalPrice - pmCommission - channelFee - paymentProcessing);
        }

        return {
            ownerPayout,
            pmCommission,
            paymentProcessing,
            channelFee,
            totalTax,
            revenue: subTotalPrice,
            payout: ownerPayout,
            managementFee: pmCommission
        };
    }
}