
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { appDatabase } from "../utils/database.util";
import { Between, EntityManager, In, Raw } from "typeorm";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Listing } from "../entity/Listing";
import { IncomeService } from "./IncomeService";
import { CategoryEntity } from "../entity/Category";
import { CategoryService } from "./CategoryService";
import { OwnerStatementEntity } from "../entity/OwnerStatement";
import { OwnerStatementIncomeEntity } from "../entity/OwnerStatementIncome";
import { OwnerStatementExpenseEntity } from "../entity/OwnerStatementExpense";
import { ReservationService } from "./ReservationService";
import { ExpenseService } from "./ExpenseService";
import { getReservationDaysInRange, formatDate, getCurrentDateInUTC, isSameOrAfterDate } from "../helpers/date";
import { ListingService } from "./ListingService";
import { ownerDetails } from "../constant";
import { ResolutionService } from "./ResolutionService";
import { UpsellOrderService } from "./UpsellOrderService";
import { UpsellOrder } from "../entity/UpsellOrder";
import { Resolution } from "../entity/Resolution";
import { ReservationInfoService } from "./ReservationInfoService";
import { ListingDetail } from "../entity/ListingDetails";

interface ReservationType {
  guestName: string;
  nights: number;
  arrivalDate: string;
  departureDate: string;
  channelId: number;
  totalPrice: number;
  channelCommissionAmount: number;
  taxAmount: number;
}

interface ExpenseType {
  concept: string;
  expenseDate: string;
  categories: string[];
  listingMapId: number;
  amount: number;
}

enum CategoryKey {
  FULL_CLAIM = 'full_claim',
  PARTIAL_CLAIM = 'partial_claim',
  SECURITY_DEPOSIT = 'security_deposit'
}

const categoriesList: Record<CategoryKey, string> = {
  [CategoryKey.FULL_CLAIM]: "Full Claim",
  [CategoryKey.PARTIAL_CLAIM]: "Partial Claim",
  [CategoryKey.SECURITY_DEPOSIT]: "Security Deposit",
};

export class AccountingReportService {

  private hostaWayClient = new HostAwayClient();
  private expenseRepo = appDatabase.getRepository(ExpenseEntity);
  private listingRepository = appDatabase.getRepository(Listing);
  private incomeService = new IncomeService();
  private categories = appDatabase.getRepository(CategoryEntity);
  private ownerStatementRepository = appDatabase.getRepository(OwnerStatementEntity);

  async printExpenseStatement(expenseData: any) {
    const { listingId, fromDate, toDate, status, page, limit } = expenseData;
    const skip = (page - 1) * limit;

    /*
    id: 29,
    expenseId: 1246703,
    listingMapId: 323647,
    expenseDate: '2024-11-13',
    concept: 'Expense test',
    amount: 1,
    isDeleted: 0,
    categories: '[2]',
    contractorName: 'Tribikram Sen',
    contractorNumber: '9864442648',
    dateOfWork: '2024-11-13',
    findings: 'Check for testing.',
    fileNames: '[]',
    status: 'Pending Approval',
    userId: 'f36d852c-f3b9-47bd-99ef-949c9058f760'
    */

    const expenses = await this.expenseRepo.find({
      where: {
        ...(listingId && { listingMapId: Number(listingId) }),
        expenseDate: Between(String(fromDate), String(toDate)),
        isDeleted: 0,
        ...(status !== "" && { status: In(status ? [status] : [ExpenseStatus.APPROVED, ExpenseStatus.PAID, ExpenseStatus.OVERDUE]) }),
        expenseId: Raw(alias => `${alias} IS NOT NULL`)
      },
      order: { id: "DESC" },
      skip,
      take: limit,
    });

    const listingMapIds = expenses
      .map((expense: any) => expense.listingMapId)
      .filter((id: any, index: number, self: any) => id != null && self.indexOf(id) === index);

    const listings = await this.listingRepository.find({
      where: { id: In(listingMapIds) }
    });

    const listingNameMap = listings.reduce((acc, listing) => {
      acc[listing.id] = listing.address;
      return acc;
    }, {});

    const categoryService = new CategoryService();
    const categoriesList = await categoryService.getAllCategories();

    const filteredExpense = expenses.map((data: any) => {

      const categoryNames = data.categories
        ? data.categories.split(',').map(id => {
          const cleanId = id.replace(/[\[\]"]/g, '');
          const category = categoriesList.find(category => category.id === Number(cleanId));
          return category ? category.categoryName : 'Unknown Category';
        }).join(', ')
        : '';

      return {
        expenseDate: data.expenseDate,
        concept: data.concept,
        amount: data.amount,
        contractorName: data.contractorName,
        categories: categoryNames,
        listing: listingNameMap[data.listingMapId] || 'N/A',
      };
    });


    const totalAmount = filteredExpense.reduce((totals, data) => {
      const amount = data.amount || 0;
      return {
        totalAmount: totals.totalAmount + amount,
      };
    }, { totalAmount: 0 });



    return {
      filteredExpense,
      totalAmount
    };

  }


  async printIncomeStatement(incomeData: any) {

    const { listingId, dateType, fromDate, toDate, page, limit, channelId, clientId, clientSecret } = incomeData;
    const offset = (page - 1) * limit;

    const reservations = await this.hostaWayClient.getReservations(
      clientId,
      clientSecret,
      listingId,
      dateType,
      fromDate,
      toDate,
      limit,
      offset,
      channelId
    );

    const validReservations = this.incomeService.filterValidReservation(reservations);

    const filteredReservations = validReservations.map((data: any) => ({
      guestName: data.guestName,
      nights: data.nights,
      arrivalDate: data.arrivalDate,
      departureDate: data.departureDate,
      channelName: data.channelName,
      totalPrice: data.totalPrice,
      listingName: data.listingName,
      cleaningFee: data.cleaningFee,
      taxAmount: data.taxAmount,
      airbnbTotalPaidAmount: data.airbnbTotalPaidAmount,
      channelCommissionAmount: data.channelCommissionAmount,
      hostawayCommissionAmount: data.hostawayCommissionAmount,
      airbnbExpectedPayoutAmount: data.airbnbExpectedPayoutAmount
    }));

    const totalCalculation = filteredReservations.reduce(
      (totals, data) => {
        const totalPrice = parseFloat((data.airbnbExpectedPayoutAmount || data.totalPrice || 0).toFixed(2));
        const totalTax = parseFloat((data.taxAmount || 0).toFixed(2));
        const cleaningFee = parseFloat((data.cleaningFee || 0).toFixed(2));
        const channelCommissionAmount = parseFloat((data.channelCommissionAmount || 0).toFixed(2));
        const airbnbTotalPaidAmount = parseFloat((data.airbnbTotalPaidAmount || 0).toFixed(2));
        const hostawayCommissionAmount = parseFloat((data.hostawayCommissionAmount || 0).toFixed(2));

        return {
          totalPrice: parseFloat((totals.totalPrice + totalPrice).toFixed(2)),
          totalTax: parseFloat((totals.totalTax + totalTax).toFixed(2)),
          cleaningFee: parseFloat((totals.cleaningFee + cleaningFee).toFixed(2)),
          channelCommissionAmount: parseFloat((totals.channelCommissionAmount + channelCommissionAmount).toFixed(2)),
          airbnbTotalPaidAmount: parseFloat((totals.airbnbTotalPaidAmount + airbnbTotalPaidAmount).toFixed(2)),
          hostawayCommissionAmount: parseFloat((totals.hostawayCommissionAmount + hostawayCommissionAmount).toFixed(2)),
        };
      },
      { totalPrice: 0, totalTax: 0, cleaningFee: 0, channelCommissionAmount: 0, airbnbTotalPaidAmount: 0, hostawayCommissionAmount: 0 }
    );

    return {
      filteredReservations,
      totalCalculation
    };

  }


  async printExpenseIncomeStatement(request: Request, userId: any) {
    const { listingId, fromDate, toDate, status, channelId, dateType, page, limit } = request.query;

    const connectedAccountService = new ConnectedAccountService();
    const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);

    const expenseQuery = { listingId, fromDate, toDate, status, page, limit };
    const incomeQuery = { listingId, dateType, fromDate, toDate, page, limit, channelId, clientId, clientSecret };


    const { filteredExpense, totalAmount } = await this.printExpenseStatement(expenseQuery);
    const { filteredReservations, totalCalculation } = await this.printIncomeStatement(incomeQuery);

    return {
      status: true,
      message: "Data found successfully!!!",
      data: {
        expenseStatement: {
          expenses: filteredExpense,
          totals: totalAmount
        },
        incomeStatement: {
          income: filteredReservations,
          totals: totalCalculation
        }
      }
    };

  }

  async fetchListings(userId: string) {
    // fetch listing
    const listings = await this.listingRepository.createQueryBuilder("listing_info")
      .select(['listing_info.id', 'listing_info.name', 'listing_info.address', 'listing_info.state', 'listing_info.city']) // added selection
      .where("listing_info.userId = :userId", { userId })
      .getMany();

    return listings;
  }

  async getListingsWithRevenue(listings: Listing[], clientId: string, clientSecret: string, dateType: string, fromDate: string, toDate: string, channelId: number) {
    const listingsWithRevenue = await Promise.all(listings.map(async (listing) => {
      // fetch reservations 
      const reservations = await this.hostaWayClient.getReservations(
        clientId,
        clientSecret,
        listing.id,
        dateType,
        fromDate,
        toDate,
        500,
        0,
        channelId
      );

      const revenue = reservations.reduce((acc, reservation: any) => {
        return acc + reservation.totalPrice;
      }, 0);

      return { ...listing, revenue };
    }));

    return listingsWithRevenue;
  }

  async getListingsWithRevenueAndExpense(listingsWithRevenue: Listing[], clientId: string, clientSecret: string) {
    const expenses = await this.hostaWayClient.getExpenses(clientId, clientSecret);

    const listingWithRevenueAndExpense = listingsWithRevenue.map((listing: any) => {
      const totalExpenses = expenses.filter(expense => expense.listingMapId === listing.id).reduce((acc, expense: any) => {
        return acc + expense.amount;
      }, 0);

      return { ...listing, expense: totalExpenses };
    });

    return listingWithRevenueAndExpense;
  }

  private async saveOwnerStatement(transactionManager: EntityManager, { fromDate, toDate, dateType, channelId, listingId, userId, invoiceNo }) {
    const newOwnerStatement = new OwnerStatementEntity();
    newOwnerStatement.fromDate = fromDate;
    newOwnerStatement.toDate = toDate;
    newOwnerStatement.dateType = dateType;
    newOwnerStatement.channel = channelId;
    newOwnerStatement.listingId = listingId;
    newOwnerStatement.createdAt = new Date();
    newOwnerStatement.updatedAt = new Date();
    newOwnerStatement.userId = userId;
    newOwnerStatement.createdBy = userId;
    newOwnerStatement.invoiceNo = invoiceNo;

    return await transactionManager.save(newOwnerStatement);
  }


  private async calculateFinancialFields(
    reservation: {
      id: number;
      listingMapId: number;
      channelId: number;
      cleaningFee: number;
      reservationDate: string;
    },
    clientId: string,
    clientSecret: string,
    pmFee: number,
    isClaimProtection: boolean,
    hidePetFee: boolean
  ) {
    // Fetch finance standard fields
    const financeStandardField = await this.hostaWayClient.financeStandardField(
      reservation.id,
      clientId,
      clientSecret
    );

    if (!financeStandardField) {
      throw new Error(`financeStandardField not found for reservationId: ${reservation.id}`);
    }

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
      if (isSameOrAfterDate(reservation.reservationDate, "2025-04-11")) {
        subTotalPrice = airbnbPayoutSum + directPayout - resortFeeAirbnb;
        airbnbCommission = (airbnbPayoutSum - resortFeeAirbnb) * pmFee;
      }
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
      if (isSameOrAfterDate(reservation.reservationDate, "2025-04-11")) {
        subTotalPrice = airbnbPayoutSum + directPayout - resortFeeAirbnb;
        vrboCommission = (directPayout - channelFee - paymentProcessing) * pmFee;
      }
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

  private handleProratedCalculation(totalAmount: number, totalNights: number, calculableNights: number): number {
    return (totalAmount / totalNights) * calculableNights;
  }


  private async saveOwnerStatementIncome(transactionManager: EntityManager, reservations: any, ownerStatementId: number, clientId: string, clientSecret: string, dateType: string, fromDate: string, toDate: string, listingPmFee: { listingId: number, pmFee: number; }[], listingDetail: ListingDetail) {
    for (const reservation of reservations) {

      let pmFee = (listingPmFee.find((listing) => listing.listingId == reservation.listingMapId)?.pmFee) / 100 || 0;
      let isClaimProtection = !!listingDetail.claimProtection;
      let hidePetFee = !!listingDetail.hidePetFee;

      //calculate ownerPayout, paymentProcessing and pmCommission
      let {
        ownerPayout,
        pmCommission,
        paymentProcessing,
        channelFee,
        totalTax,
        revenue,
        managementFee,
        payout,
      } = await this.calculateFinancialFields(reservation, clientId, clientSecret, pmFee, isClaimProtection, hidePetFee);

      let totalNights = reservation.nights;
      let totalAmount = reservation.totalPrice;
      let calculableNights = reservation.nights;

      if (dateType == "prorated") {
        calculableNights = getReservationDaysInRange(fromDate, toDate, reservation.arrivalDate, reservation.departureDate);
        totalAmount = totalAmount != 0 && this.handleProratedCalculation(totalAmount, totalNights, calculableNights);
        ownerPayout = ownerPayout != 0 && this.handleProratedCalculation(ownerPayout, totalNights, calculableNights);
        pmCommission = pmCommission != 0 && this.handleProratedCalculation(pmCommission, totalNights, calculableNights);
        paymentProcessing = paymentProcessing != 0 && this.handleProratedCalculation(paymentProcessing, totalNights, calculableNights);
        channelFee = channelFee != 0 && this.handleProratedCalculation(channelFee, totalNights, calculableNights);
        totalTax = totalTax != 0 && this.handleProratedCalculation(totalTax, totalNights, calculableNights);
        revenue = revenue != 0 && this.handleProratedCalculation(revenue, totalNights, calculableNights);
        managementFee = managementFee != 0 && this.handleProratedCalculation(managementFee, totalNights, calculableNights);
        payout = payout != 0 && this.handleProratedCalculation(payout, totalNights, calculableNights);
      }

      const newIncome = new OwnerStatementIncomeEntity();
      newIncome.ownerStatementId = ownerStatementId;
      newIncome.guest = reservation.guestName;
      newIncome.nights = calculableNights;
      newIncome.checkInDate = reservation.arrivalDate;
      newIncome.checkOutDate = reservation.departureDate;
      newIncome.channel = reservation.channelId;
      newIncome.totalPaid = totalAmount;
      newIncome.ownerPayout = ownerPayout;
      newIncome.pmCommission = pmCommission;
      newIncome.paymentProcessing = paymentProcessing;
      newIncome.channelFee = channelFee;
      newIncome.totalTax = totalTax;
      newIncome.revenue = revenue;
      newIncome.managementFee = managementFee;
      newIncome.payout = payout;
      newIncome.createdAt = new Date();
      newIncome.updatedAt = new Date();

      await transactionManager.save(newIncome);
    }
  }

  private async saveOwnerStatementExpense(transactionManager: EntityManager, expenses: Partial<ExpenseEntity[]>, listingNames: { id: number, name: string, internalListingName: string; }[], categories: CategoryEntity[], ownerStatementId: number) {
    for (const expense of expenses) {
      const newExpense = new OwnerStatementExpenseEntity();

      const categoryNames = expense.categories
        ? expense.categories.split(',').map(id => {
          const cleanId = id.replace(/[\[\]"]/g, '');
          // Find the category name matching the cleaned ID
          const category = categories.find(category => category.id === Number(cleanId));

          // Return the category name if found, otherwise return a placeholder
          return category ? category.categoryName : 'Unknown Category';
        }).join(', ')
        : '';

      newExpense.ownerStatementId = ownerStatementId;
      newExpense.concept = expense.concept;
      newExpense.date = expense.expenseDate;
      newExpense.categories = categoryNames;
      newExpense.listingId = expense.listingMapId;
      newExpense.listingName = listingNames.find(listing => listing.id == expense.listingMapId).internalListingName;
      newExpense.reservationId = null;
      newExpense.guestName = null;
      newExpense.amount = expense.amount * -1;
      newExpense.createdAt = new Date();
      newExpense.updatedAt = new Date();

      await transactionManager.save(newExpense);
    }
  }

  private calculateCommissionAndProcessingFee(amount: number, pmFee: number) {
    return amount * (pmFee + 0.03);
  }

  private async saveOwnerStatementResolutionCommissionAndProcessingFee(transactionManager: EntityManager, resolution: Resolution, ownerStatementId: number, listingNames: { id: number, name: string, internalListingName: string; }[], listingPmFee: { listingId: number, pmFee: number; }[]) {
    let pmFee = (listingPmFee.find((listing) => listing.listingId == resolution.listingMapId)?.pmFee) / 100 || 0;

    const newResolution = new OwnerStatementExpenseEntity();
    newResolution.ownerStatementId = ownerStatementId;
    newResolution.concept = resolution.category.split('_').includes('claim') ? "Claim: Commission & Processing Fee" : "Security Deposit: Commission & Processing Fee";
    newResolution.date = String(resolution.claimDate);
    newResolution.categories = "";
    newResolution.listingId = resolution.listingMapId;
    newResolution.listingName = listingNames.find(listing => listing.id == resolution.listingMapId).internalListingName;
    newResolution.reservationId = null;
    newResolution.guestName = resolution.guestName;
    newResolution.amount = this.calculateCommissionAndProcessingFee(resolution.amount, pmFee) * -1;
    newResolution.createdAt = new Date();
    newResolution.updatedAt = new Date();

    await transactionManager.save(newResolution);
  }

  private async saveOwnerStatementUpsellCommissionAndProcessingFee(transactionManager: EntityManager, upsell: UpsellOrder, ownerStatementId: number, listingNames: { id: number, name: string, internalListingName: string; }[], listingPmFee: { listingId: number, pmFee: number; }[]) {
    let pmFee = (listingPmFee.find((listing) => listing.listingId == Number(upsell.listing_id))?.pmFee) / 100 || 0;

    const newUpsell = new OwnerStatementExpenseEntity();
    newUpsell.ownerStatementId = ownerStatementId;
    newUpsell.concept = "Upsell: Commission & Processing Fee";
    newUpsell.date = String(upsell.arrival_date);
    newUpsell.categories = "";
    newUpsell.listingId = Number(upsell.listing_id);
    newUpsell.listingName = listingNames.find(listing => listing.id == Number(upsell.listing_id)).internalListingName;
    newUpsell.reservationId = Number(upsell.booking_id);
    newUpsell.guestName = upsell.client_name;
    newUpsell.amount = this.calculateCommissionAndProcessingFee(upsell.cost, pmFee) * -1;
    newUpsell.createdAt = new Date();
    newUpsell.updatedAt = new Date();

    await transactionManager.save(newUpsell);
  }

  private async saveOwnerStatementResolution(transactionManager: EntityManager, resolutions: Resolution[], ownerStatementId: number, listingNames: { id: number, name: string, internalListingName: string; }[], listingPmFee: { listingId: number, pmFee: number; }[]) {

    for (const resolution of resolutions) {
      const newResolution = new OwnerStatementExpenseEntity();
      newResolution.ownerStatementId = ownerStatementId;
      newResolution.concept = resolution.category.split('_').includes('claim') ? "Claims" : "Security Deposit";
      newResolution.date = String(resolution.claimDate);
      newResolution.categories = "Resolution";
      newResolution.listingId = resolution.listingMapId;
      newResolution.listingName = listingNames.find(listing => listing.id == resolution.listingMapId).internalListingName;
      newResolution.reservationId = null;
      newResolution.guestName = resolution.guestName;
      newResolution.amount = resolution.amount;
      newResolution.createdAt = new Date();
      newResolution.updatedAt = new Date();

      await transactionManager.save(newResolution);
      await this.saveOwnerStatementResolutionCommissionAndProcessingFee(transactionManager, resolution, ownerStatementId, listingNames, listingPmFee)
    }
  }

  private async saveOwnerStatementUpsell(transactionManager: EntityManager, upsells: UpsellOrder[], ownerStatementId: number, listingNames: { id: number, name: string, internalListingName: string; }[], listingPmFee: { listingId: number, pmFee: number; }[]) {
    for (const upsell of upsells) {
      const newUpsell = new OwnerStatementExpenseEntity();
      newUpsell.ownerStatementId = ownerStatementId;
      newUpsell.concept = upsell.type;
      newUpsell.date = String(upsell.arrival_date);
      newUpsell.categories = "Upsell";
      newUpsell.listingId = Number(upsell.listing_id);
      newUpsell.listingName = listingNames.find(listing => listing.id == Number(upsell.listing_id)).internalListingName;
      newUpsell.reservationId = Number(upsell.booking_id);
      newUpsell.guestName = upsell.client_name;
      newUpsell.amount = upsell.cost;
      newUpsell.createdAt = new Date();
      newUpsell.updatedAt = new Date();

      await transactionManager.save(newUpsell);
      await this.saveOwnerStatementUpsellCommissionAndProcessingFee(transactionManager, upsell, ownerStatementId, listingNames, listingPmFee)
    }
  }

  // async createOwnerStatement(request: Request, userId: string) {
  //   const { fromDate, toDate, dateType, channelId, listingId } = request.body;

  //   const connectedAccountService = new ConnectedAccountService();
  //   const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);

  //   const reservationInfoService = new ReservationInfoService();
  //   const reservations = await reservationInfoService.getReservations(fromDate, toDate, listingId, dateType, channelId)

  //   const listingService = new ListingService();
  //   const listingPmFee = await listingService.getListingPmFee();
  //   const listingNames = await listingService.getListingNames(userId);

  //   const categoryService = new CategoryService();
  //   const categoryNames = await categoryService.getAllCategories();

  //   const expenseService = new ExpenseService();
  //   const expenses = await expenseService.getExpenses(fromDate, toDate, listingId);

  //   const resolutionService = new ResolutionService();
  //   const resolutions = await resolutionService.getResolution(fromDate, toDate, listingId);

  //   const upsellOrderService = new UpsellOrderService();
  //   const upsells = await upsellOrderService.getUpsells(fromDate, toDate, listingId);

  //   return await appDatabase.transaction(async (transactionManager: EntityManager) => {
  //     // Save owner statement details
  //     const newOwnerStatement = await this.saveOwnerStatement(transactionManager, {
  //       fromDate,
  //       toDate,
  //       dateType,
  //       channelId,
  //       listingId,
  //       userId
  //     });

  //     // Save owner-statement-income
  //     await this.saveOwnerStatementIncome(transactionManager, reservations, newOwnerStatement.id, clientId, clientSecret, dateType, fromDate, toDate, listingPmFee);

  //     // Save owner-statement expense, resolution and upsell
  //     await this.saveOwnerStatementExpense(transactionManager, expenses, listingNames, categoryNames, newOwnerStatement.id);
  //     await this.saveOwnerStatementResolution(transactionManager, resolutions, newOwnerStatement.id, listingNames);
  //     await this.saveOwnerStatementUpsell(transactionManager, upsells, newOwnerStatement.id, listingNames);

  //     return {
  //       status: true,
  //       message: "Owner statement created successfully!!!",
  //     };
  //   });
  // }

  async createOwnerStatement(request: Request, userId: string) {
    const { fromDate, toDate, dateType, channelId, listingId, invoiceNo } = request.body;

    // Initialize services 
    const connectedAccountService = new ConnectedAccountService();
    const reservationInfoService = new ReservationInfoService();
    const listingService = new ListingService();
    const categoryService = new CategoryService();
    const expenseService = new ExpenseService();
    const resolutionService = new ResolutionService();
    const upsellOrderService = new UpsellOrderService();

    const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);
    
    const [reservations, listingPmFee, listingNames, listingDetail, categoryNames, expenses, resolutions, upsells] = await Promise.all([
      reservationInfoService.getReservations(fromDate, toDate, listingId, dateType, channelId),
      listingService.getListingPmFee(),
      listingService.getListingNames(userId),
      listingService.getListingDetailByListingId(listingId),
      categoryService.getAllCategories(),
      expenseService.getExpenses(fromDate, toDate, listingId),
      resolutionService.getResolution(fromDate, toDate, listingId),
      upsellOrderService.getUpsells(fromDate, toDate, listingId),
    ]);

    return await appDatabase.transaction(async (transactionManager: EntityManager) => {
      // Save owner statement details
      const newOwnerStatement = await this.saveOwnerStatement(transactionManager, {
        fromDate,
        toDate,
        dateType,
        channelId,
        listingId,
        userId,
        invoiceNo: invoiceNo.toString().padStart(4, '0')
      });

      // Save owner-statement income, expense, resolution, and upsell in parallel
      await Promise.all([
        this.saveOwnerStatementIncome(
          transactionManager, reservations, newOwnerStatement.id, clientId, clientSecret, dateType, fromDate, toDate, listingPmFee, listingDetail
        ),
        this.saveOwnerStatementExpense(transactionManager, expenses, listingNames, categoryNames, newOwnerStatement.id),
        this.saveOwnerStatementResolution(transactionManager, resolutions, newOwnerStatement.id, listingNames, listingPmFee),
        this.saveOwnerStatementUpsell(transactionManager, upsells, newOwnerStatement.id, listingNames, listingPmFee),
      ]);

      return { status: true, message: "Owner statement created successfully!!!" };
    });
  }

  async getOwnerStatements(userId: string, listingId: number) {

    let query = this.ownerStatementRepository
      .createQueryBuilder("owner_statements")
      .leftJoinAndSelect("owner_statements.income", "owner_statement_income")
      .leftJoinAndSelect("owner_statements.expense", "owner_statement_expense")
      .where("owner_statements.userId = :userId", { userId })
      .orderBy("owner_statements.fromDate", "DESC")
      .addOrderBy("owner_statements.toDate", "DESC");

    // Conditionally add listingId to the where clause if it's provided
    if (listingId) {
      query = query.andWhere("owner_statements.listingId = :listingId", { listingId });
    }

    const ownerStatements = await query.getMany();

    const reservationService = new ReservationService();
    const channels = await reservationService.getChannelList();

    const updatedStatements = await Promise.all(
      ownerStatements.map(async (statement) => {
        // Calculate revenue and expense
        const revenue = statement.income.reduce(
          (sum: number, item: any) => sum + parseFloat(item.totalPaid || "0"),
          0
        );
        const expense = statement.expense.reduce(
          (sum: number, item: any) => sum + parseFloat(item.amount || "0"),
          0
        );

        const updatedIncome = statement.income.map((item: any) => {
          const channel = channels.find((ch) => ch.channelId === item.channel);
          return {
            ...item,
            channelName: channel?.channelName || "Unknown",
          };
        });

        const listing = await this.listingRepository
          .createQueryBuilder("listing")
          .where("listing.id = :id", { id: statement.listingId })
          .andWhere("listing.userId = :userId", { userId })
          .getOne();

        return {
          ...statement,
          income: updatedIncome,
          fromDate: formatDate(statement.fromDate),
          toDate: formatDate(statement.toDate),
          currentDate: formatDate(getCurrentDateInUTC()),
          revenue: revenue.toFixed(2),
          expenses: expense.toFixed(2),
          listingName: listing?.internalListingName,
          address: listing?.address,
          city: listing?.city,
          state: listing?.state,
          invoiceNo: statement.invoiceNo,
          ownerDetails: ownerDetails[statement.listingId] || null
        };
      })
    );

    return updatedStatements;
  }


}