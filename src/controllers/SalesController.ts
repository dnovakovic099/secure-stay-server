import { NextFunction, Request, Response } from "express";
import { ClientService } from "../services/SalesService";
import { LoginCredentials } from "../types";
import {
  calculatingTotalProjectRevenue,
  extractAirDnaListingId,
  extractImagesFromCompetitorListingLink,
  extractImagesFromListingLink,
  generateRandomUA,
  getDataForSpecificListing,
  imageToBase64,
  login,
  setBedBathGuestCounts,
  takeScreenShots,
} from "../helpers/airdna";
import puppeteer, { Browser } from "puppeteer";
import {
  BG_SECTION_IMAGE,
  BORDER_IMAGE,
  ICON_DOLLAR_CHART,
  ICON_GEARS,
  ICON_HAND_HOLDIING_USERS,
  ICON_OPPORTUNITIES_1,
  ICON_OPPORTUNITIES_2,
  ICON_OPPORTUNITIES_3,
  ICON_USER_STARS,
  LOGO_URL,
  LOGO_WHITE_URL,
  MAC_BOOK_IMAGE,
  NEW_LOGO,
  NEW_LOGO_WHITE,
  OVERLAY_IMAGE,
  PAGE_10_IMG,
  PAGE_12_IMG,
  PAGE_14_IMG,
  PAGE_1_IMAGE,
  PAGE_2_IMAGE,
  PAGE_3_IMAGE,
  PAGE_7_IMG_1,
  PAGE_7_IMG_2,
  PORTFOLIO_IMAGES,
  PROPERTY_REVENUE_REPORT_PATH,
  PUPPETEER_LAUNCH_OPTIONS,
  REVENUE_ICONS,
  BADGE_RIGHT_TOP,
  BADGE_LEFT_BOTTOM,
} from "../constants";
import path from "path";
import ejs from "ejs";
import fs from "fs";
import logger from "../utils/logger.utils";
import { calculateProspectCompetitor } from "../helpers/calculateProspectCompetitor";
import { calculateMonthlyAverageRevPAR } from "../helpers/calculateMonthlyAverageRevPAR";
import { findTop4PeakSeasons } from "../helpers/findTop4PeakSeasons";
import * as XLSX from 'xlsx';
import { promisify } from 'util';
import { calculateRevenue } from "../helpers/calculateRevenue";

interface CustomRequest extends Request {
  user?: any;
}

const readFileAsync = promisify(fs.readFile);

interface ExcelRow {
  address?: string;
  Address?: string;
  bathCount?: string | number;
  BathCount?: string | number;
  bedCount?: string | number;
  BedCount?: string | number;
}

export class SalesController {
  async createClient(request: Request, response: Response, next: NextFunction) {
    try {
      const clientService = new ClientService();
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
  async updateClient(request: CustomRequest, response: Response) {
    const clientId = parseInt(request.params.client_id);
    const { airDnaData, ...rest } = request.body;
    const clientService = new ClientService();
    const userId = request.user.id;
    try {
      const updatedClient = await clientService.updateClient(clientId, rest, userId);
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
      page.setDefaultTimeout(60000);

      const customUA = generateRandomUA();

      // Set custom user agent
      await page.setUserAgent(customUA);

      await page.setViewport({
        width: 1920,
        height: 1080,
        // deviceScaleFactor: 2,
      });

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
      await page.waitForSelector(".css-1a9leff");
      const searchInputSelector =
        'input[placeholder="Search market, submarket, or address"]';
      await page.type(searchInputSelector, address as string);

      const dropdownSelector = ".MuiAutocomplete-popper li";
      await page.waitForSelector(dropdownSelector);

      const listings = await page.$$(dropdownSelector);
      // await page.waitForNetworkIdle();
      await new Promise(resolve => setTimeout(resolve, 20000));



      if (!listings.length) {
        await browser.close();
        response
          .status(404)
          .json({ error: "No Listings available for this address" });
      }
      await listings[0].click();
      // await page.waitForNetworkIdle();
      await new Promise(resolve => setTimeout(resolve, 20000));
      const apiResponse = await setBedBathGuestCounts(page, rest);

      const screenShots = await takeScreenShots(page, rest.beds);

      if (screenShots.error) {
        await browser.close();
        return response.status(400).json({
          error: screenShots.error,
        });
      }

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
      const fetchedCompetitor = await clientService.getClientCompetitorListing(clientId);
      const wasClientUpdated = await clientService.checkIfClientWasUpdated(
        clientId
      );

      if (fetchedClient.client.previewDocumentLink && wasClientUpdated) {
        return response.status(200).send({
          status: true,
          message: "PDF generated successfully",
          pdfPath: fetchedClient.client.previewDocumentLink,
        });
      }
      if (fetchedClient.listing && fetchedClient.client) {
        const templatePath = path.resolve(PROPERTY_REVENUE_REPORT_PATH);
        // console.log("fetchedListing", fetchedListing);
        const {
          revenueRange,
          revenue,
          screenshotSessionId,
          propertyScreenshotSessionId,
          details,
          rating: listingRating,
          metrics,
        } = fetchedClient.listing;


        const {
          occupancy: listingOccupancy,
        } = metrics;

        const competitorRating = fetchedCompetitor.rating;


        const {
          occupancy: competitorOccupancy,
        } = fetchedCompetitor.metrics;

        console.log("screenshotSessionId", screenshotSessionId);

        const { propertyScreenshotSessionId: specificCompetitorScreenshotSessionId } = fetchedCompetitor;

        console.log("specificCompetitorScreenshotSessionId", specificCompetitorScreenshotSessionId);

        const screenshotFolderPath = path.resolve(
          "public",
          screenshotSessionId
        );
        const propertyScreenshotFolderPath = path.resolve(
          "public",
          propertyScreenshotSessionId
        );
        const specificCompetitorScreenshotFolderPath = path.resolve("public", specificCompetitorScreenshotSessionId);
        const propertyStatisticsGraphSS = imageToBase64(
          path.join(screenshotFolderPath, "propertyStatisticsGraph.png")
        );
        const revenueGraphSS = imageToBase64(
          path.join(screenshotFolderPath, "revenueGraph.png")
        );
        const nearbyPropertyLisingSS = imageToBase64(
          path.join(screenshotFolderPath, "nearbyPropertyListings.png")
        );
        const occupancySection1SS = imageToBase64(
          path.join(screenshotFolderPath, "occupancySection1.png")
        );
        const occupancySection2SS = imageToBase64(
          path.join(screenshotFolderPath, "occupancySection2.png")
        );
        const occupancySection3SS = imageToBase64(
          path.join(screenshotFolderPath, "occupancySection3.png")
        );

        const averageMonthlyOccupancyChartSS = imageToBase64(
          path.join(screenshotFolderPath, "averageMonthlyOccupancyChart.png")
        );




        const revparCsvFilePath = path.join(screenshotFolderPath, 'revparHighestInYear_last_12_month.csv');
        const revparCsvData = fs.readFileSync(revparCsvFilePath, 'utf8');
        const revparCsvLines = revparCsvData.split('\n').slice(1); // Skip header line

        const revparData = revparCsvLines.map(line => {
          const [date, revpar] = line.split(',');
          if (date && revpar) {
            const cleanRevpar = revpar.replace(/"/g, '').trim();
            const revparNumber = parseFloat(cleanRevpar);
            if (!isNaN(revparNumber)) {
              return { date: new Date(date), revpar: revparNumber };
            } else {
              console.error(`Failed to parse RevPAR value: ${revpar}`);
            }
          }
          return null;
        }).filter(item => item !== null);

        const monthlyAverageRevPAR = calculateMonthlyAverageRevPAR(revparData);
        const top4PeakSeasons = findTop4PeakSeasons(monthlyAverageRevPAR);


        const csvFilePath = path.join(screenshotFolderPath, 'revenueAverage_last_12_month.csv');
        const csvData = fs.readFileSync(csvFilePath, 'utf8');
        console.log("csvData", csvData);
        const csvLines = csvData.split('\n').slice(1); // Skip header line

        const revenueListFromCSV = [];
        const revenueDateFromCSV = [];

        csvLines.forEach(line => {
          const [date, revenue] = line.split(',');
          if (date && revenue) {
            const formattedDate = new Date(date).toLocaleString('default', { month: 'long', year: '2-digit' });
            revenueDateFromCSV.push(formattedDate);
            // Remove quotes and trim whitespace before parsing
            const cleanRevenue = revenue.replace(/"/g, '').trim();
            const revenueNumber = parseFloat(cleanRevenue);
            if (!isNaN(revenueNumber)) {
              revenueListFromCSV.push(revenueNumber);
            } else {
              console.error(`Failed to parse revenue value: ${revenue}`);
              // Push a default value or 0 to maintain array indexing
              revenueListFromCSV.push(0);
            }
          }
        });


        console.log("revenueListFromCSV", revenueListFromCSV);
        console.log("revenueDateFromCSV", revenueDateFromCSV);


        const specificListing = {
          heroSection: imageToBase64(
            path.join(propertyScreenshotFolderPath, "heroSection.png")
          ),
          middleSection: imageToBase64(
            path.join(propertyScreenshotFolderPath, "imgSection.png")
          ),
          statSection: imageToBase64(
            path.join(propertyScreenshotFolderPath, "statSection.png")
          ),
          airbnbLink: "",
          occupancy: listingOccupancy,
          rating: listingRating,
        };

        const listingAirbnbLinkPath = path.join(propertyScreenshotFolderPath, "airbnb-link.txt");
        const listingAirbnbLink = fs.readFileSync(listingAirbnbLinkPath, "utf8").trim();
        specificListing.airbnbLink = listingAirbnbLink;

        const specificCompetitor = {
          heroSection: imageToBase64(
            path.join(specificCompetitorScreenshotFolderPath, "heroSection.png")
          ),
          middleSection: imageToBase64(
            path.join(specificCompetitorScreenshotFolderPath, "imgSection.png")
          ),
          statSection: imageToBase64(
            path.join(specificCompetitorScreenshotFolderPath, "statSection.png")
          ),
          airbnbLink: "",
          occupancy: competitorOccupancy,
          rating: competitorRating,
        };

        let competitorRevenuePotential = null;

        const competitorRevenuePotentialPath = path.join(specificCompetitorScreenshotFolderPath, "competitor-revenue-potential.txt");
        if (fs.existsSync(competitorRevenuePotentialPath)) {
          const revenueString = fs.readFileSync(competitorRevenuePotentialPath, "utf8").trim();
          competitorRevenuePotential = parseFloat(revenueString);
        }

        console.log("competitorRevenuePotential", competitorRevenuePotential);

        const competitorNamePath = path.join(specificCompetitorScreenshotFolderPath, "competitor-name.txt");
        const competitorName = fs.readFileSync(competitorNamePath, "utf8").trim();
        console.log("competitorName", competitorName);

        const prospectCompetitorCalculation = {
          competitor: [] as number[],
          competitorSum: 0,
          prospect: [] as number[],
          prospectSum: 0,
          marketAvg: [] as number[],
          marketAvgSum: 0,
          date: [] as string[],
        }

        if (competitorRevenuePotential && revenueListFromCSV.length > 0) {
          const { competitor, prospect } = calculateProspectCompetitor(revenueListFromCSV, competitorRevenuePotential);
          prospectCompetitorCalculation.competitor = competitor.map(val => val * 1000);
          prospectCompetitorCalculation.prospect = prospect.map(val => val * 1000);
          prospectCompetitorCalculation.marketAvg = revenueListFromCSV;
          prospectCompetitorCalculation.date = revenueDateFromCSV;
          prospectCompetitorCalculation.competitorSum = competitor.reduce((sum, val) => sum + val, 0) * 1000;
          prospectCompetitorCalculation.prospectSum = prospect.reduce((sum, val) => sum + val, 0) * 1000;
          prospectCompetitorCalculation.marketAvgSum = revenueListFromCSV.reduce((sum, val) => sum + val, 0);
        }

        console.log("prospectCompetitorCalculation", prospectCompetitorCalculation);



        const competitorAirbnbLinkPath = path.join(specificCompetitorScreenshotFolderPath, "airbnb-link.txt");
        const competitorAirbnbLink = fs.readFileSync(competitorAirbnbLinkPath, "utf8").trim();
        specificCompetitor.airbnbLink = competitorAirbnbLink;


        // Calculations for PDF
        const dailyRate = (revenue / (listingOccupancy * 365)).toFixed(2);
        const revPar = (parseFloat(dailyRate) * listingOccupancy).toFixed(2);
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
          PAGE_4_CARDS: {
            occupancySection1: occupancySection1SS,
            occupancySection2: occupancySection2SS,
            occupancySection3: occupancySection3SS,
          },
          PAGE_6_IMG_1: averageMonthlyOccupancyChartSS,
          PAGE_6_IMG_2: revenueGraphSS,
          PAGE_7_IMG_1,
          PAGE_7_IMG_2,
          PAGE_9_IMG: nearbyPropertyLisingSS,
          PAGE_10_IMG,
          PORTFOLIO_IMAGES,
          PAGE_14_IMG,
          revenueRange,
          dailyRate,
          revPar,
          MAC_BOOK_IMAGE,
          specificListing,
          specificCompetitor,
          propertyDetails: details,
          ICON_GEARS,
          ICON_DOLLAR_CHART,
          ICON_HAND_HOLDIING_USERS,
          ICON_USER_STARS,
          NEW_LOGO,
          NEW_LOGO_WHITE,
          ICON_OPPORTUNITIES_1,
          ICON_OPPORTUNITIES_2,
          ICON_OPPORTUNITIES_3,
          prospectCompetitorCalculation,
          top4PeakSeasons,
          BADGE_RIGHT_TOP,
          BADGE_LEFT_BOTTOM,
          competitorName,
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

  async getDetailsForListing(request: Request, response: Response, next: NextFunction) {
    const { listingLink } = request.query as {
      listingLink: string;
    };
    let browser: Browser;
    try {
      browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
      const page = await browser.newPage();
      const customUA = generateRandomUA();
      page.setDefaultTimeout(60000);
      await page.setUserAgent(customUA);
      await page.setViewport({ width: 1920, height: 1080 });
      const credentials: LoginCredentials = {
        email: process.env.AIRDNA_EMAIL,
        password: process.env.AIRDNA_PASSWORD,
      };
      const isLoggedIn = await login(page, credentials);
      if (!isLoggedIn) {
        await browser.close();
        return response
          .status(400)
          .json({ error: "Unable to Log into AirDna" });
      }
      await page.waitForSelector(".css-1a9leff");
      // await page.goto(listingLink, {
      //   waitUntil: "load",
      // });
      const apiResponse = await getDataForSpecificListing(page, listingLink);
      const { screenshotSessionId, error } = await extractImagesFromListingLink(page);
      console.log("ssid===>>", apiResponse, screenshotSessionId, error)

      if (error) {
        await browser.close();
        return response.status(400).json({
          error: error,
        });
      }

      await browser.close();
      if (apiResponse.success && screenshotSessionId) {
        return response.json({
          success: true,
          ...apiResponse.data.payload,
          ssid: screenshotSessionId,
        });
      }
      await browser.close();
      return response.status(404).json({
        error: "There was an error fetching from the requested link",
      });
    } catch (error) {
      logger.error(error);
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("Error closing browser:", closeError);
        }
      }
      return next(error);
    }
  }


  async getDetailsForCompetitorListing(request: Request, response: Response, next: NextFunction) {
    const { competitorListingLink } = request.query as {
      competitorListingLink: string;
    };
    let browser: Browser;
    try {
      browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
      const page = await browser.newPage();
      const customUA = generateRandomUA();
      page.setDefaultTimeout(60000);
      await page.setUserAgent(customUA);
      await page.setViewport({ width: 1920, height: 1080 });
      const credentials: LoginCredentials = {
        email: process.env.AIRDNA_EMAIL,
        password: process.env.AIRDNA_PASSWORD,
      };
      const isLoggedIn = await login(page, credentials);
      if (!isLoggedIn) {
        await browser.close();
        return response
          .status(400)
          .json({ error: "Unable to Log into AirDna" });
      }
      await page.waitForSelector(".css-1a9leff");
      // await page.goto(listingLink, {
      //   waitUntil: "load",
      // });
      const apiResponse = await getDataForSpecificListing(page, competitorListingLink);
      const { screenshotSessionId, error } = await extractImagesFromCompetitorListingLink(page);
      console.log("ssid===>>", apiResponse, screenshotSessionId, error);

      if (error) {
        await browser.close();
        return response.status(400).json({
          error: error,
        });
      }

      await browser.close();
      if (apiResponse.success && screenshotSessionId) {
        return response.json({
          success: true,
          ...apiResponse.data.payload,
          ssid: screenshotSessionId,
        });
      }
      await browser.close();
      return response.status(404).json({
        error: "There was an error fetching from the requested link",
      });
    } catch (error) {
      logger.error(error);
      if (browser) {
        try {
          await browser.close();
        } catch (closeError) {
          console.error("Error closing browser:", closeError);
        }
      }
      return next(error);
    }
  }

  async uploadRevenueReport(request: Request, response: Response, next: NextFunction) {
    try {
      const files = request.files as { [fieldname: string]: Express.Multer.File[] };
      if (!files || !files['file'] || files['file'].length === 0) {
        return response.status(400).json({
          error: "No file uploaded",
        });
      }

      const file = files['file'][0];
      const fileExtension = file.originalname.split('.').pop()?.toLowerCase();
      const allowedExtensions = ['csv', 'xls', 'xlsx'];

      if (!fileExtension || !allowedExtensions.includes(fileExtension)) {
        return response.status(400).json({
          error: "Invalid file type. Please upload a CSV or Excel file.",
        });
      }

      let data;
      const fileBuffer = await readFileAsync(file.path);

      if (fileExtension === 'csv') {
        const text = fileBuffer.toString('utf-8');
        const rows = text.split("\n").filter(row => row.trim() !== "");

        if (rows.length < 2) {
          throw new Error("File is empty or contains only headers");
        }

        data = rows.slice(1).map(row => {
          // Find the last two commas to separate address from bedCount and bathCount
          const lastCommaIndex = row.lastIndexOf(',');
          const secondLastCommaIndex = row.lastIndexOf(',', lastCommaIndex - 1);

          if (lastCommaIndex === -1 || secondLastCommaIndex === -1) {
            throw new Error("Invalid row format. Expected: 'address, bedCount, bathCount'");
          }

          const address = row.substring(0, secondLastCommaIndex).trim().replace(/"/g, '');
          const bedCount = row.substring(secondLastCommaIndex + 1, lastCommaIndex).trim().replace(/"/g, '');
          const bathCount = row.substring(lastCommaIndex + 1).trim().replace(/"/g, '');

          return {
            address,
            bedCount: parseInt(bedCount) || 0,
            bathCount: parseInt(bathCount) || 0
          };
        });

        if (data.length > 10) {
          throw new Error("The file should not contain more than 10 rows.");
        }
      } else {
        // Handle Excel files (both XLS and XLSX)
        const workbook = XLSX.read(fileBuffer, { type: "buffer" });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

        if (jsonData.length === 0) {
          throw new Error("File is empty or contains no data");
        }

        if (jsonData.length > 10) {
          throw new Error("The file should not contain more than 10 rows.");
        }
        data = jsonData.map(row => {
          const keys = Object.keys(row);
          const address = typeof row[keys[0]] === 'string' ? row[keys[0]].trim().replace(/"/g, '') : '';
          const bedCount = typeof row[keys[1]] === 'string' ? row[keys[1]].trim().replace(/"/g, '') : row[keys[1]];
          const bathCount = typeof row[keys[2]] === 'string' ? row[keys[2]].trim().replace(/"/g, '') : row[keys[2]];

          return {
            address,
            bedCount: parseInt(bedCount) || 0,
            bathCount: parseInt(bathCount) || 0
          };
        });
      }

      // Clean up the uploaded file
      await fs.promises.unlink(file.path);


      const report: {
        address: string;
        bedCount: number;
        bathCount: number;
        revenue: number;

      }[] = [];


      const credentials: LoginCredentials = {
        email: process.env.AIRDNA_EMAIL,
        password: process.env.AIRDNA_PASSWORD,
      };

      let browser: Browser;
      try {
        browser = await puppeteer.launch(PUPPETEER_LAUNCH_OPTIONS);
        const page = await browser.newPage();
        const customUA = generateRandomUA();

        await page.setUserAgent(customUA);
        await page.setViewport({ width: 1920, height: 1080 });

        const isLoggedIn = await login(page, credentials);
        if (!isLoggedIn) {
          await browser.close();
          return response.status(400).json({
            error: "Unable to Log into AirDna"
          });
        }

        for (const row of data) {
          const { address, bedCount, bathCount } = row;
          await page.waitForSelector(".css-1a9leff");
          const searchInputSelector =
            'input[placeholder="Search market, submarket, or address"]';
          await page.type(searchInputSelector, address as string);

          const dropdownSelector = ".MuiAutocomplete-popper li";
          await page.waitForSelector(dropdownSelector);

          const listings = await page.$$(dropdownSelector);
          // await page.waitForNetworkIdle();
          await new Promise(resolve => setTimeout(resolve, 20000));



          if (!listings.length) {
            await browser.close();
            response
              .status(404)
              .json({ error: "No Listings available for this address" });
          }
          await listings[0].click();
          // await page.waitForNetworkIdle();
          await new Promise(resolve => setTimeout(resolve, 20000));

          const revenue = await calculateRevenue(page, address, bedCount, bathCount);
          report.push({
            address,
            bedCount,
            bathCount,
            revenue
          });
        }

      } catch (error) {
        console.error("Error processing file:", error);
        return response.status(500).json({
          error: "Error processing file",
          details: error instanceof Error ? error.message : "Unknown error"
        });
      }





    } catch (error) {
      console.error("Error processing file:", error);
      return response.status(500).json({
        error: "Error processing file",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

}
