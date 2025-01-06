import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";
import { LoginCredentials } from "../types";
import {
  generateRandomUA,
  login,
  scrapeAllDataFromSelectedListing,
  setBedBathGuestCounts,
  transformData,
} from "../helpers/airdna";
import puppeteer, { Browser } from "puppeteer";
import { PUPPETEER_LAUNCH_OPTIONS } from "../constants";

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
      page.setDefaultTimeout(60000);

      const customUA = generateRandomUA();

      // Set custom user agent
      await page.setUserAgent(customUA);

      // await page.setViewport({ width: 1920, height: 1080 });

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
      await page.waitForSelector(dropdownSelector, { timeout: 6000 });

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
      const allElements = await scrapeAllDataFromSelectedListing(page);

      const processedData = transformData(allElements);
      await browser.close();
      if (!apiResponse.success) {
        return response.status(400).json({
          error: "The Listing doesn't have the required details.",
        });
      }
      return response.json(apiResponse.data);
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
}
