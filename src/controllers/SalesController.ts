import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";
import { LoginCredentials } from "../types";
import {
  generateRandomUA,
  login,
  scrapeAllDataFromSelectedListing,
  setBedBathGuestCounts,
  takeScreenShots,
  transformData,
} from "../helpers/airdna";
import puppeteer, { Browser } from "puppeteer";
import {
  BG_SECTION_IMAGE,
  LOGO_URL,
  PAGE_10_IMG,
  PAGE_12_IMG,
  PAGE_14_IMG,
  PAGE_1_IMAGE,
  PAGE_2_IMAGE,
  PAGE_3_IMAGE,
  PAGE_4_CARD_1,
  PAGE_4_CARD_2,
  PAGE_4_CARD_3,
  PAGE_4_IMAGE,
  PAGE_6_IMG_1,
  PAGE_7_IMG_1,
  PAGE_7_IMG_2,
  PAGE_9_IMG,
  PROPERTY_REVENUE_REPORT_PATH,
  PUPPETEER_LAUNCH_OPTIONS,
} from "../constants";
import path from "path";
import ejs from "ejs";
import fs from "fs";

export class SalesController {
  async createClient(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.send(await clientService.createClient(request));
  }
  async getAllClients(request: Request, response: Response) {
    const clientService = new ClientService();
    return response.json({
      data: await clientService.getAllClients(),
    });
  }
  async updateClient(request: Request, response: Response) {
    const clientId = parseInt(request.params.client_id);
    const clientService = new ClientService();
    try {
      const updatedClient = await clientService.updateClient(
        clientId,
        request.body
      );
      if (updatedClient) {
        return response.json(updatedClient);
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
    try {
      const fetchedListing = await clientService.getClientListing(clientId);
      if (fetchedListing.listing && fetchedListing.client) {
        const templatePath = path.resolve(PROPERTY_REVENUE_REPORT_PATH);
        // console.log("fetchedListing", fetchedListing);
        const { revenueRange, propertyStatisticsGraphSS } =
          fetchedListing.listing;

        const currentYear = new Date().getFullYear();
        const html = await ejs.renderFile(templatePath, {
          title: "Property Performance Report",
          listingData: fetchedListing.listing,
          clientData: fetchedListing.client,
          currentYear,
          LOGO_URL,
          PAGE_1_IMAGE,
          PAGE_2_IMAGE,
          PAGE_3_IMAGE,
          PAGE_4_IMAGE: propertyStatisticsGraphSS,
          BG_SECTION_IMAGE,
          PAGE_4_CARD_1,
          PAGE_4_CARD_2,
          PAGE_4_CARD_3,
          PAGE_6_IMG_1,
          PAGE_7_IMG_1,
          PAGE_7_IMG_2,
          PAGE_9_IMG,
          PAGE_10_IMG,
          PAGE_12_IMG,
          PAGE_14_IMG,
          revenueRange,
        });
        browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        const pdfBuffer = await page.pdf({
          format: "A4",
          printBackground: true,
        });
        const pdfFileName = `../../../public/${clientId}/property-revenue-report-${Date.now()}.pdf`;
        const pdfFilePath = path.resolve(__dirname, "public", pdfFileName);
        const pdfDir = path.dirname(pdfFilePath);
        if (!fs.existsSync(pdfDir)) {
          fs.mkdirSync(pdfDir, { recursive: true });
        }
        const pdfPath = `${
          process.env.BASE_URL
        }/public/${clientId}/property-revenue-report-${Date.now()}.pdf`;
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
        await browser.close();
        return response.status(200).json({
          message: "PDF generated and saved successfully",
          pdfPath,
          // uploadedFiles,
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
}
