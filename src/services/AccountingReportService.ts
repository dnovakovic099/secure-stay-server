
import { Request } from "express";
import { HostAwayClient } from "../client/HostAwayClient";
import { ConnectedAccountService } from "./ConnectedAccountService";
import { appDatabase } from "../utils/database.util";
import { Between, In, Raw } from "typeorm";
import { ExpenseEntity, ExpenseStatus } from "../entity/Expense";
import { Listing } from "../entity/Listing";
import { IncomeService } from "./IncomeService";
import { CategoryEntity } from "../entity/Category";
import { CategoryService } from "./CategoryService";

export class AccountingReportService {

  private hostaWayClient = new HostAwayClient();
  private expenseRepo = appDatabase.getRepository(ExpenseEntity);
  private listingRepository = appDatabase.getRepository(Listing);
  private incomeService = new IncomeService();
  private categories = appDatabase.getRepository(CategoryEntity);

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

}