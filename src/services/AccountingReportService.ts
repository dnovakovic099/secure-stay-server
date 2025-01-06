
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
import { removeNullValues } from "../helpers/helpers";
import { ListingService } from "./ListingService";

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
  categoriesNames: string[];
  listingMapId: number;
  reservationId: number;
  amount: number;
}

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

  private async saveOwnerStatement(transactionManager: EntityManager, { fromDate, toDate, dateType, channelId, listingId, userId }) {
    const newOwnerStatement = new OwnerStatementEntity();
    newOwnerStatement.fromDate = fromDate;
    newOwnerStatement.toDate = toDate;
    newOwnerStatement.dateType = dateType;
    newOwnerStatement.channel = channelId;
    newOwnerStatement.listingId = listingId;
    newOwnerStatement.createdAt = new Date();
    newOwnerStatement.updatedAt = new Date();
    newOwnerStatement.userId = userId;

    return await transactionManager.save(newOwnerStatement);
  }

  private async calculateFinancialFields(reservationId: number, clientId: string, clientSecret: string) {
    const financeStandardField = await this.hostaWayClient.financeStandardField(reservationId, clientId, clientSecret);
    if (!financeStandardField) {
      throw new Error(`FinanceStandardField not found for reservationId: ${reservationId}`);
    }

    const filteredFinanceStandardField = removeNullValues(financeStandardField);

    const totalTax =
      parseFloat(filteredFinanceStandardField?.vat || 0) +
      parseFloat(filteredFinanceStandardField?.hotelTax || 0) +
      parseFloat(filteredFinanceStandardField?.lodgingTax || 0) +
      parseFloat(filteredFinanceStandardField?.salesTax || 0) +
      parseFloat(filteredFinanceStandardField?.occupancyTax || 0) +
      parseFloat(filteredFinanceStandardField?.cityTax || 0) +
      parseFloat(filteredFinanceStandardField?.roomTax || 0) +
      parseFloat(filteredFinanceStandardField?.otherTaxes || 0);

    const directPayout =
      parseFloat(filteredFinanceStandardField?.baseRate || 0) +
      parseFloat(filteredFinanceStandardField?.cleaningFee || 0) +
      totalTax +
      parseFloat(filteredFinanceStandardField?.petFee || 0) +
      parseFloat(filteredFinanceStandardField?.weeklyDiscount || 0) +
      parseFloat(filteredFinanceStandardField?.couponDiscount || 0) +
      parseFloat(filteredFinanceStandardField?.monthlyDiscount || 0) +
      parseFloat(filteredFinanceStandardField?.cancellationPayout || 0) +
      parseFloat(filteredFinanceStandardField?.otherFees || 0);

    const ownerPayout = parseFloat(filteredFinanceStandardField?.airbnbPayoutSum || 0) + directPayout;
    const paymentProcessing = directPayout * 0.03;
    const airbnbCommission = parseFloat(filteredFinanceStandardField?.airbnbPayoutSum || 0) * 0.1;
    const VRBOCommission = directPayout * 0.1;
    const pmCommission = airbnbCommission + VRBOCommission;

    return { ownerPayout, paymentProcessing, pmCommission };

  }

  private async saveOwnerStatementIncome(transactionManager: EntityManager, reservations: any, ownerStatementId: number, clientId: string, clientSecret: string) {
    for (const reservation of reservations) {

      //calculate ownerPayout, paymentProcessing and pmCommission
      const {
        ownerPayout,
        pmCommission,
        paymentProcessing
      } = await this.calculateFinancialFields(reservation.id, clientId, clientSecret);

      const newIncome = new OwnerStatementIncomeEntity();
      newIncome.ownerStatementId = ownerStatementId;
      newIncome.guest = reservation.guestName;
      newIncome.nights = reservation.nights;
      newIncome.checkInDate = reservation.arrivalDate;
      newIncome.checkOutDate = reservation.departureDate;
      newIncome.channel = reservation.channelId;
      newIncome.totalPaid = reservation.totalPrice;
      newIncome.ownerPayout = ownerPayout;
      newIncome.pmCommission = pmCommission;
      newIncome.paymentProcessing = paymentProcessing;
      newIncome.channelFee = reservation.channelCommissionAmount;
      newIncome.totalTax = reservation.taxAmount;
      newIncome.createdAt = new Date();
      newIncome.updatedAt = new Date();

      await transactionManager.save(newIncome);
    }
  }

  private async saveOwnerStatementExpense(transactionManager: EntityManager, expenses: ExpenseType[], ownerStatementId: number) {
    for (const expense of expenses) {
      const newExpense = new OwnerStatementExpenseEntity();
      newExpense.ownerStatementId = ownerStatementId;
      newExpense.concept = expense.concept;
      newExpense.date = expense.expenseDate;
      newExpense.categories = JSON.stringify(expense.categoriesNames);
      newExpense.listingId = expense.listingMapId;
      newExpense.reservationId = expense.reservationId;
      newExpense.amount = expense.amount;
      newExpense.createdAt = new Date();
      newExpense.updatedAt = new Date();

      await transactionManager.save(newExpense);
    }
  }

  private filterExpenses(expenses: ExpenseType[], fromDate: string, toDate: string, listingId: number) {
    return expenses.filter((expense) => {
      const expenseDate = new Date(expense.expenseDate);
      const checkIn = new Date(fromDate);
      const checkOut = new Date(toDate);
      return expense.listingMapId === listingId && expenseDate >= checkIn && expenseDate <= checkOut;
    });
  }

  async createOwnerStatement(request: Request, userId: string) {
    const { fromDate, toDate, dateType, channelId, listingId } = request.body;

    const connectedAccountService = new ConnectedAccountService();
    const { clientId, clientSecret } = await connectedAccountService.getPmAccountInfo(userId);

    return await appDatabase.transaction(async (transactionManager: EntityManager) => {
      // Save owner statement details
      const newOwnerStatement = await this.saveOwnerStatement(transactionManager, {
        fromDate,
        toDate,
        dateType,
        channelId,
        listingId,
        userId
      });

      // Save owner-statement-income
      const reservationService = new ReservationService();
      const reservations = await reservationService.fetchReservations(
        clientId,
        clientSecret,
        listingId,
        dateType,
        fromDate,
        toDate,
        500,
        0,
        channelId
      );
      await this.saveOwnerStatementIncome(transactionManager, reservations, newOwnerStatement.id, clientId, clientSecret);

      // Save owner-statement-expense
      const expenseService = new ExpenseService();
      const expenses = await expenseService.getExpensesFromHostaway(clientId, clientSecret);
      const filteredExpenses = this.filterExpenses(expenses, fromDate, toDate, listingId);
      await this.saveOwnerStatementExpense(transactionManager, filteredExpenses, newOwnerStatement.id);

      return {
        status: true,
        message: "Owner statement created successfully!!!",
      };
    });
  }


  async getOwnerStatements(userId: string) {

    const ownerStatements = await this.ownerStatementRepository
      .createQueryBuilder("owner_statements")
      .leftJoinAndSelect("owner_statements.income", "owner_statement_income")
      .leftJoinAndSelect("owner_statements.expense", "owner_statement_expense")
      .where("owner_statements.userId = :userId", { userId })
      .getMany();

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

        const listing = await this.listingRepository
          .createQueryBuilder("listing")
          .where("listing.id = :id", { id: statement.listingId })
          .andWhere("listing.userId = :userId", { userId })
          .getOne();

        return {
          ...statement,
          revenue: revenue.toFixed(2),
          expenses: expense.toFixed(2),
          listingName: listing?.name,
          address: listing?.address,
          city: listing?.city,
          state: listing?.state,
        };
      })
    );

    return updatedStatements;
  }


}