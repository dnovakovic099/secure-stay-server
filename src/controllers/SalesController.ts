import { NextFunction, Request, Response } from "express";
import { ClientService } from "../services/SalesService";
import { LoginCredentials } from "../types";
import {
  calculatingTotalProjectRevenue,
  generateRandomUA,
  imageToBase64,
  login,
  setBedBathGuestCounts,
  takeScreenShots,
} from "../helpers/airdna";
import puppeteer, { Browser } from "puppeteer";
import {
  BG_SECTION_IMAGE,
  BORDER_IMAGE,
  LOGO_URL,
  LOGO_WHITE_URL,
  MAC_BOOK_IMAGE,
  OVERLAY_IMAGE,
  PAGE_10_IMG,
  PAGE_12_IMG,
  PAGE_14_IMG,
  PAGE_1_IMAGE,
  PAGE_2_IMAGE,
  PAGE_3_IMAGE,
  PAGE_7_IMG_1,
  PAGE_7_IMG_2,
  PROPERTY_REVENUE_REPORT_PATH,
  PUPPETEER_LAUNCH_OPTIONS,
  REVENUE_ICONS,
} from "../constants";
import path from "path";
import ejs from "ejs";
import fs from "fs";

export class SalesController {
  async createClient(request: Request, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
      // console.log("request.files", request.files);

      // let fileNames: string[] = [];
      // if (
      //   Array.isArray(request.files["attachments"]) &&
      //   request.files["attachments"].length > 0
      // ) {
      //   fileNames = (request.files["attachments"] as Express.Multer.File[]).map(
      //     (file) => file.filename
      //   );
      // }
      // console.log("fileNames", fileNames);
      // return response.status(404).json({ error: "Client not found" });
      return response.send(await clientService.createClient(request));
    } catch (error) {
      console.log("error", error);

      next(error);
    }
  }
  async getAllClients(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.json({
      data: await clientService.getAllClients(),
    });
  }
  async updateClient(request: Request, response: Response) {
    const clientId = parseInt(request.params.client_id);
    const { airDnaData, ...rest } = request.body;
    const clientService = new ClientService();
    try {
      const updatedClient = await clientService.updateClient(clientId, rest);
      if (updatedClient) {
        const updatedListing = await clientService.updateClientListing(
          clientId,
          airDnaData
        );
        if (updatedListing) {
          return response.json(updatedClient);
        }
      }
      return response.status(404).json({ error: "Client not found" });
    } catch (error) {
      return response.status(500).json({ error: "Unable to update client" });
    }
  }
  async getDetailsFromAirDna(request: Request, response: Response) {
    const { address, ...rest } = request.query as {
      address: string;
      beds: string;
      baths: string;
      guests: string;
    };

    const credentials: LoginCredentials = {
      email: process.env.AIRDNA_EMAIL,
      password: process.env.AIRDNA_PASSWORD,
    };

    let browser: Browser;

    try {
      browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
      const page = await browser.newPage();
      // page.setDefaultTimeout(60000);

      const customUA = generateRandomUA();

      // Set custom user agent
      await page.setUserAgent(customUA);

      await page.setViewport({ width: 1920, height: 1080 });

      // await page.setRequestInterception(true);
      // Disable unnecessary resources
      // page.on("request", (request) => {
      //   if (["image", "stylesheet", "font"].includes(request.resourceType())) {
      //     request.abort();
      //   } else {
      //     request.continue();
      //   }
      // });

      const isLoggedIn = await login(page, credentials);
      if (!isLoggedIn) {
        await browser.close();
        response.status(400).json({ error: "Unable to Log into AirDna" });
      }
      await page.waitForSelector(".css-1a9leff", { timeout: 10000 });
      const searchInputSelector =
        'input[placeholder="Search market, submarket, or address"]';
      await page.type(searchInputSelector, address as string);

      const dropdownSelector = ".MuiAutocomplete-popper li";
      await page.waitForSelector(dropdownSelector);

      const listings = await page.$$(dropdownSelector);
      await page.waitForNetworkIdle();
      if (!listings.length) {
        await browser.close();
        response
          .status(404)
          .json({ error: "No Listings available for this address" });
      }
      await listings[0].click();
      await page.waitForNetworkIdle();
      const apiResponse = await setBedBathGuestCounts(page, rest);

      const screenShots = await takeScreenShots(page);

      // const allElements = await scrapeAllDataFromSelectedListing(page);

      // const processedData = transformData(allElements); // Leaving this here incase we need to use it later for the pdf

      await browser.close();
      if (!apiResponse.success) {
        return response.status(400).json({
          error: "The Listing doesn't have the required details.",
        });
      }

      const responseData = {
        ...apiResponse.data.payload,
        ...screenShots,
      };

      return response.json(responseData);
    } catch (error) {
      console.log("error", error);
      if (browser) {
        await browser.close();
      }
      return response.status(500).json({
        error,
        message: "Failed to fetch details for the selected address.",
      });
    }
  }
  async generatePdf(request: Request, response: Response) {
    const clientId = parseInt(request.params.client_id);
    // const attachments = request.files["attachments"] as Express.Multer.File[];
    const clientService = new ClientService();

    let browser: Browser;
    const date = Date.now();
    try {
      const fetchedClient = await clientService.getClientListing(clientId);
      const wasClientUpdated = await clientService.checkIfClientWasUpdated(
        clientId
      );

      if (fetchedClient.client.previewDocumentLink && !wasClientUpdated) {
        return response.status(200).send({
          status: true,
          message: "PDF generated successfully",
          pdfPath: fetchedClient.client.previewDocumentLink,
        });
      }
      if (fetchedClient.listing && fetchedClient.client) {
        const templatePath = path.resolve(PROPERTY_REVENUE_REPORT_PATH);
        // console.log("fetchedListing", fetchedListing);
        const { revenueRange, revenue, occupancy, screenshotSessionId } =
          fetchedClient.listing;

        const screenshotFolderPath = path.resolve(
          "public",
          screenshotSessionId
        );
        const propertyStatisticsGraphSS = imageToBase64(
          path.join(screenshotFolderPath, "propertyStatisticsGraph.png")
        );
        const revenueGraphSS = imageToBase64(
          path.join(screenshotFolderPath, "revenueGraph.png")
        );
        const nearbyPropertyLisingSS = imageToBase64(
          path.join(screenshotFolderPath, "nearbyPropertyListings.png")
        );
        const occupancySectionSS = imageToBase64(
          path.join(screenshotFolderPath, "occupancySection.png")
        );
        const averageMonthlyOccupancyChartSS = imageToBase64(
          path.join(screenshotFolderPath, "averageMonthlyOccupancyChart.png")
        );
        // Calculations for PDF
        const dailyRate = (revenue / (occupancy * 365)).toFixed(2);
        const revPar = (parseFloat(dailyRate) * occupancy).toFixed(2);
        const currentYear = new Date().getFullYear();
        const { totalClient, totalCompetitor, totalMarketAvg } =
          calculatingTotalProjectRevenue(revenueRange);
        const html = await ejs.renderFile(templatePath, {
          title: "Property Performance Report",
          listingData: {
            ...fetchedClient.listing,
            totalClient,
            totalCompetitor,
            totalMarketAvg,
          },
          clientData: fetchedClient.client,
          currentYear,
          LOGO_WHITE_URL,
          LOGO_URL,
          REVENUE_ICONS,
          OVERLAY_IMAGE,
          BORDER_IMAGE,
          PAGE_1_IMAGE,
          PAGE_2_IMAGE,
          PAGE_3_IMAGE,
          PAGE_4_IMAGE: propertyStatisticsGraphSS,
          BG_SECTION_IMAGE,
          PAGE_4_CARD: occupancySectionSS,
          PAGE_6_IMG_1: averageMonthlyOccupancyChartSS,
          PAGE_6_IMG_2: revenueGraphSS,
          PAGE_7_IMG_1,
          PAGE_7_IMG_2,
          PAGE_9_IMG: nearbyPropertyLisingSS,
          PAGE_10_IMG,
          PAGE_12_IMG,
          PAGE_14_IMG,
          revenueRange,
          dailyRate,
          revPar,
          MAC_BOOK_IMAGE,
        });
        browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        // const pdfFileName = `public/property-performance-report.pdf`;
        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
          // path: pdfFileName,
          timeout: 0,
        });
        const pdfFileName = `${clientId}/property-performance-report-${date}.pdf`;
        const pdfFilePath = path.resolve("public", pdfFileName);
        const pdfDir = path.dirname(pdfFilePath);
        if (!fs.existsSync(pdfDir)) {
          fs.mkdirSync(pdfDir, { recursive: true });
        }
        const pdfPath = `${process.env.BASE_URL}/public/${clientId}/property-performance-report-${date}.pdf`;
        fs.writeFileSync(pdfFilePath, pdfBuffer);

        const pdfSaved = await clientService.saveGeneratedPdfLink(
          clientId,
          pdfPath
        );
        if (!pdfSaved) {
          return response.status(404).json({ error: "Client not found" });
        }
        // console.log("attachments", attachments);

        // let uploadedFiles;
        // if (Array.isArray(attachments) && attachments.length > 0) {
        //   uploadedFiles = attachments?.map((file) => ({
        //     originalName: file.originalname,
        //     storedPath: file.path,
        //   }));
        // }

        // Delete the screenshot folder after generating the PDF
        // if (fs.existsSync(screenshotFolderPath)) {
        //   try {
        //     // Remove the folder and its contents
        //     fs.rmSync(screenshotFolderPath, { recursive: true, force: true });
        //   } catch (err) {
        //     console.log("Error deleting screenshot folder:", err);
        //   }
        // }

        await browser.close();
        return response.status(200).send({
          status: true,
          message: "PDF generated successfully",
          pdfPath,
        });
      }
      return response
        .status(404)
        .json({ error: "Listing for client not found" });
    } catch (error) {
      console.log("error", error);

      if (browser) {
        await browser.close();
      }
      return response.status(500).json({ error: "Unable to generate pdf" });
    }
  }

  async getDetailsForListing(request: Request, response: Response) {
    const { listingLink } = request.query;
    let browser: Browser;
    console.log("listingLink", listingLink);

    try {
      browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
      const page = await browser.newPage();
      const customUA = generateRandomUA();
      await page.setUserAgent(customUA);
      await page.setViewport({ width: 1920, height: 1080 });
      const credentials: LoginCredentials = {
        email: process.env.AIRDNA_EMAIL,
        password: process.env.AIRDNA_PASSWORD,
      };
      const isLoggedIn = await login(page, credentials);
      if (!isLoggedIn) {
        await browser.close();
        response.status(400).json({ error: "Unable to Log into AirDna" });
      }
      await page.goto(listingLink as string);
    } catch (error) {
      if (browser) {
        await browser.close();
      }
      return response
        .status(500)
        .json({ error: "Unable to fetch details from the airdna link" });
    }
  }
}
