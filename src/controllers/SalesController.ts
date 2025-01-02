import { Request, Response } from "express";
import { ClientService } from "../services/SalesService";
import { LoginCredentials } from "../types";
import { login, scrapeDataFromSelectedAddress } from "../helpers/airdna";
import puppeteer from "puppeteer";

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
    const address = request.query.address as string;
    if (!address) {
      return response.status(400).json({ error: "Address is required" });
    }

    const credentials: LoginCredentials = {
      email: process.env.AIRDNA_EMAIL,
      password: process.env.AIRDNA_PASSWORD,
    };

    try {
      const browser = await puppeteer.launch();
      const page = await browser.newPage();

      await page.setViewport({ width: 1920, height: 1080 });

      // Disable unnecessary resources
      await page.setRequestInterception(true);
      // page.on("request", (request) => {
      //   if (
      //     ["image", "stylesheet", "font", "script"].includes(
      //       request.resourceType()
      //     )
      //   ) {
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
      await page.type(searchInputSelector, address);

      const dropdownSelector = ".MuiAutocomplete-popper li";
      await page.waitForSelector(dropdownSelector, { timeout: 5000 });

      const listings = await page.$$(dropdownSelector);
      await page.waitForNetworkIdle({ timeout: 2000 });
      if (!listings.length) {
        await browser.close();
        response
          .status(404)
          .json({ error: "No Listings available for this address" });
      }
      await listings[0].click();
      await page.waitForNetworkIdle({ timeout: 5000 });

      const scrappedData = await scrapeDataFromSelectedAddress(page);

      await browser.close();
      return response.json({ data: scrappedData });
    } catch (error) {
      return response
        .status(500)
        .json({ error: "Failed to fetch details for the selected address." });
    }
  }
}
